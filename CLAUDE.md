# TASK MANAGER — Agenda Inteligente de Tarefas

Sistema web (mobile-first, funciona no PC) para distribuir tarefas entre **solicitantes (Usuário Y)**
e **funcionários (Usuário X)**, com agenda automática, aparelhos (Workstation), logs e tutoriais.
Idioma da interface e dos textos: **português do Brasil**. Responda ao usuário em português.

## Estrutura
JavaScript puro, **sem build**: scripts clássicos carregados em ordem pelo `index.html`
(todos compartilham o escopo global; funciona até abrindo o arquivo direto, via `file://`).

```
index.html                 esqueleto HTML + ordem de carregamento dos scripts
css/styles.css             tema (tokens em :root / [data-theme=dark]) e componentes
js/runtime/                config.js (escolhe o back-end + URL/chave pública do Supabase),
                           supabase-runtime.js (banco/login/tempo real no Supabase — produção),
                           local-runtime.js (localStorage + login simulado — desenvolvimento/testes).
                           Ambos expõem claude.use('db'|'auth'|'user') com a mesma API.
supabase/schema.sql        tabelas, RLS, funções, tempo real e visões (idempotente)
js/core/                   utils.js (DOM, datas, formatação, cripto, imagens),
                           constants.js (status, prioridades, cargos, PRESETS),
                           state.js (objetos `state` e `ui`, acesso ao banco)
js/domain/                 regras de negócio, sem HTML:
                           schedule.js (semana, findSlot, fitsAt, disponibilidade),
                           tasks.js (criar/aceitar/iniciar/concluir/reagendar),
                           devices.js (aparelhos, categorias, problemas, tutoriais),
                           layout.js (ordem e grupos dos aparelhos),
                           auth.js (login, contas salvas, assinaturas onSnapshot)
js/views/                  funções que devolvem HTML (string): components, layout,
                           agenda, tasks, team, devices, account, notifications,
                           tutorials, modals
js/app/                    render.js (abas e render()), actions.js (o que cada botão faz),
                           events.js (listeners globais), drag.js (arrastar tarefas),
                           device-drag.js (arrastar aparelhos/grupos), main.js (boot)
tests/smoke.py             teste rápido (cadastro + login)
tests/e2e.py               teste ponta a ponta dos fluxos principais (relógio fixo, modo local)
tests/supabase_e2e.py      integração real com o Supabase (2 navegadores, tempo real, RLS) + limpeza
```

## Como rodar
`python -m http.server 8000` na pasta e abrir http://localhost:8000 (ou extensão Live Server).
Por padrão usa o **Supabase** (projeto `fguabpdfmqjcmvrpdicg`, região São Paulo).
Modo local (dados no localStorage, chave `tm_db_v1`): abrir com `?backend=local`
ou `localStorage.setItem('tm_backend','local')`.

## Banco (Supabase)
- Cada coleção é uma tabela `{id text, data jsonb}` + colunas geradas (`emp`, `req`, `dev`, `owner`, `to_user`…)
  usadas em índices e permissões. `update()` do app = função `doc_merge` (mescla jsonb).
- Login: Supabase Auth (`profiles.id = auth.uid()`); a coleção `cred` só existe no modo local.
- RLS (ver `supabase/schema.sql`): só usuários logados; perfil só o dono edita; tarefa o solicitante cria e só
  solicitante/responsável alteram; aparelho o dono (ou quem tem tarefa vinculada) altera; notificação só o
  destinatário lê; tutoriais só funcionários editam. Por isso reencaixar a agenda (`scheduleWaiting`) só roda
  no cliente do próprio funcionário.
- Mudou o esquema? Edite `supabase/schema.sql` e execute-o de novo (é idempotente).
- Visões para relatórios: `v_tasks`, `v_devices`.

Testes: `pip install playwright && playwright install chromium`, depois
`python tests/smoke.py` e `python tests/e2e.py` (modo local). Rode o e2e após qualquer mudança.
`python tests/supabase_e2e.py` testa contra o Supabase real (exige confirmação de e-mail desligada e
`~/.supabase-token` para limpar os usuários de teste).

## Modelo de dados (coleções do banco)
- `cred/<id>` — só no modo local: `{salt, hash, aid}` credenciais (PBKDF2 no navegador). `id` = hash do e-mail.
- `profiles/<aid>` — `{name, role:'func'|'sol', email, ck, theme, seen, start,end,bs,be (jornada),
  off:[{s,e,note}] (folgas pontuais), wk:[0..6] (folga semanal), ws:{cargo,cats,hidden,probs,setup,s1,layout}}`.
  `ws.layout` = organização dos aparelhos: `[{type:'dev',id} | {type:'group',id,name,cat?,items:[devId]}]`
  (sem layout, cada categoria vira um grupo — ver `js/domain/layout.js`).
  Solicitante: `devCatOrder:[categoria]` = ordem das categorias na aba Aparelhos.
  `ws.probs[categoria]` = lista de problemas de manutenção (senão usa `PRESETS`).
  Perfis antigos podem ter `ws.areas` no lugar de `ws.cats` (tratado por `savedCategories()`).
- `tasks/<id>` — `{title,desc,prio:'alta|neutra|baixa',dur,emp,req,status,start,initial,hist[],summary,
  dev,devName,devArea,devIp,devPrev,preset,tipo:'manutencao'}`. `devPrev` = status do aparelho antes da tarefa.
  Status: `aguardando` → `pendente`/`agendada` → `andamento` ⇄ `pausada` → `concluida` | `cancelada`.
- `devices/<id>` — `{owner,name,ip,area,status:'Operacional|Inoperante|Em manutenção|Fora de uso',log[],created}`.
- `notifs/<id>` — `{to,txt,at}`.
- `tutorials/<id>` — um documento por passo: `{cat,prob,order,img(dataURL),txt,by}`.
- localStorage (fora do banco): `theme`, `accts` (contas salvas), `tm_backend`; modo local: `aid` (sessão);
  Supabase: sessão do Auth, `tm_keep` (manter conectado) e `tm_sessions` (sessões das contas salvas).

**Não renomeie campos nem chaves**: os dados já gravados nos navegadores dependem deles.

## Regras de negócio principais
- Solicitante cria a tarefa **sem duração**; só o funcionário define a duração e agenda
  (arrastando o cartão para um horário livre, tocando no cartão e depois no horário, ou botão "Auto").
- Agenda limitada à **semana corrente dentro do mês** (`currentWeek()`); `findSlot()` respeita jornada,
  intervalo, folgas (`off`), folga semanal (`wk`) e tarefas já marcadas.
- Todo encaixe automático segue a urgência (`placeByPriority()`): ao aceitar (botão "Aceitar") e ao reencaixar
  pendentes (`scheduleWaiting()`, ex.: após +15 min, início antecipado, folgas), a tarefa ignora as agendadas
  de urgência menor e ocupa o primeiro horário livre; essas são empurradas para depois, na mesma ordem
  (`pushBackLowerPriority()`). Tarefas iniciadas e as de urgência igual/maior não se mexem (FIFO entre iguais).
  Arrastar para um horário é escolha manual e não reorganiza nada.
- Agenda: em telas ≥ 900px, agenda à esquerda e painel "Em andamento" fixo à direita (cartão detalhado com
  progresso, tempo decorrido/restante, dados e histórico; atualiza a cada 30 s). No celular o painel fica no topo.
  Clicar no cartão fixo (fora dos botões) rola até a tarefa na agenda e a destaca (`focusTaskInAgenda()`).
  Cartões de tarefa: início → previsão de término no topo, linha, título; só a tarefa em andamento tem a borda
  inteira na cor da prioridade (`.card.running`).
- Uma tarefa em andamento por vez (por funcionário). Iniciar antes do horário puxa a tarefa para agora;
  concluir antes do previsto encurta a duração e libera o horário.
- Tarefa vinculada a aparelho vira "Manutenção"; o relato da conclusão vai para o log do aparelho.
  Status do aparelho (tudo registrado no log): tarefa criada → "Inoperante" (vermelho) até o funcionário iniciar;
  iniciada (andamento/pausada) → "Em manutenção" (amarelo); ao encerrar, se o status ainda for automático
  (Inoperante/Em manutenção): com outra tarefa aberta, segue o que ela pede; sem nenhuma, concluída → "Operacional",
  cancelada/recusada → volta ao `devPrev`. Ver `js/domain/tasks.js` (seção "Status do aparelho vinculado").
- O funcionário define o horário de trabalho (entrada, saída e almoço) em Menu → "Horário de trabalho e folgas"
  (validação: entrada < almoço início < almoço fim < saída).
- Folga nova (semanal ou pontual) ou mudança no horário de trabalho devolve para "pendente" as tarefas
  agendadas que ficarem fora e reagenda automaticamente.
- O funcionário organiza os aparelhos na Workstation arrastando (mouse: cartão inteiro; toque: alça ⠿):
  borda de outro aparelho = reordena; meio = cria grupo (ou entra no grupo dele); fora dos grupos = solta.
- Na aba Aparelhos do **solicitante**, os aparelhos de todos aparecem agrupados por categoria; ele só pode
  arrastar as categorias para reordenar (sem mover aparelhos nem desfazer grupos). A ordem é pessoal:
  `profiles/<id>.devCatOrder = [categoria…]` (`requesterCategoryOrder()` / `moveCategory()` em `js/domain/layout.js`).
- Solicitante só enxerga: agenda (outros horários aparecem como "Ocupado"), Equipe, Aparelhos (somente leitura).
- Ninguém é notificado das próprias ações (`notify()` ignora o próprio usuário).

## Convenções do código
- Nomes em inglês no código, textos da interface em português.
- `viewXxx()` devolvem o HTML de uma aba; componentes em `views/components.js`.
  Todo texto do usuário/banco passa por `esc()`; `when(cond, html)` e `each(lista, fn)` ajudam a montar HTML.
- `render()` redesenha tudo a partir de `state`/`ui`; não redesenha enquanto há campo de texto em foco
  em `<main>` (fora da Agenda) nem durante arrasto (`ui.drag`).
- Cliques passam por um listener global (`app/events.js`) que despacha para `ACTIONS_BY_ID[btn.id]`
  ou `ACTIONS_BY_DATA[chave do data-*]` (`app/actions.js`). Para um botão novo, adicione a entrada lá.
- Modais: `openModal(html, {wide})` / `closeModal()`; o botão `#dn_no` fecha qualquer modal.
- `say(msg)` mostra um toast; `notify(userId, txt)` cria notificação;
  `commitTask(id, patch, txt)` atualiza tarefa + histórico (e o estado local na hora).
- Ids de elementos com prefixo por tela (`a_` login, `f_` nova tarefa, `dv_` aparelho, `p_`/`em_`/`pw_` conta,
  `o_` folga, `w_`/`wc_` workstation, `tu_` tutorial) — os testes dependem deles.
- Tema: variáveis CSS em `:root` e `:root[data-theme=dark]`.

## Limitações conhecidas / próximos passos
- Regras de agenda rodam no navegador; o RLS limita quem altera o quê, mas a lógica não é validada no
  servidor. Próximo passo possível: mover ações críticas para funções do banco (RPC).
- Fotos dos tutoriais ficam no jsonb (data URL); para muitas fotos, mover para o Supabase Storage.
- Confirmação de e-mail desligada (o plano grátis só envia 2 e-mails/hora); para religar, configurar SMTP próprio.
- Só a categoria **Impressora** tem problemas pré-definidos de fábrica; faltam Computador, Raspberry Pi, Orange Pi, Móvel 0–3.
- Tutoriais (Menu ☰ → Tutoriais) estão prontos, mas sem conteúdo.
- Fotos de aparelhos ainda não existem (o cartão usa o ícone da categoria).
