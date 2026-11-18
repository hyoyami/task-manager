# TASK MANAGER — Agenda Inteligente de Tarefas

Sistema web (mobile-first, funciona no PC), **multiempresa**, para distribuir tarefas entre
**solicitantes (Usuário Y)** e **funcionários (Usuário X)**, com um **administrador** por empresa,
agenda automática, aparelhos (Área de Trabalho), logs e tutoriais.
Idioma da interface e dos textos: **português do Brasil**. Responda ao usuário em português.

## Estrutura
JavaScript puro, **sem build**: scripts clássicos carregados em ordem pelo `index.html`
(todos compartilham o escopo global; funciona até abrindo o arquivo direto, via `file://`).

```
index.html                 esqueleto HTML + ordem de carregamento dos scripts
confirmado.html            página do link de confirmação de e-mail (independente do app)
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
                           company.js (empresa, membros, convites, funções, categorias, problemas),
                           holidays.js (endereço pelo CEP e feriados da cidade),
                           devices.js (aparelhos da empresa, tutoriais),
                           layout.js (ordem e grupos dos aparelhos),
                           auth.js (login, contas salvas, assinaturas onSnapshot)
js/views/                  funções que devolvem HTML (string): components, layout,
                           agenda, tasks, team, devices, account, notifications,
                           tutorials, modals, onboarding (entrar/criar empresa),
                           company (aba Empresa do administrador)
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
- Cada coleção é uma tabela `{id text, data jsonb}` + colunas geradas (`company`, `emp`, `req`, `dev`, `owner`,
  `to_user`…) usadas em índices e permissões. `update()` do app = função `doc_merge` (mescla jsonb);
  `db.call('join_with_invite', {code})` = entrar pelo link de convite; `claim_task` = assumir tarefa aberta;
  `username_available` / `email_for_username` = nome de usuário (RPCs validadas no servidor).
- Login: Supabase Auth (`profiles.id = auth.uid()`); a coleção `cred` só existe no modo local.
  **Confirmação de e-mail ligada**: o signUp envia `{name, username}` nos metadados e o gatilho `handle_new_user`
  (em `auth.users`) cria o perfil (username repetido desfaz o cadastro). Sem sessão até confirmar: o app mostra
  "Confirme seu e-mail" (`ui.authMode='check'`, reenviar link); o link abre `confirmado.html` (lê o resultado na URL,
  apaga os tokens, oferece reenviar se expirou). Site URL/redirects no Supabase: `https://hyoyami.github.io/task-manager/**`
  e `localhost:8000`. Modelos de e-mail em português em `supabase/email/` (aplicar no painel quando houver SMTP próprio).
- RLS (ver `supabase/schema.sql`): cada tabela só mostra linhas da empresa do usuário (`my_company()`, só
  membros **ativos**). Tarefa: o solicitante cria e só solicitante/responsável alteram; aparelho: funcionários e
  admin cadastram/alteram (solicitante só com tarefa vinculada), apagam quem cadastrou e o admin; notificação só o
  destinatário lê; tutoriais: funcionários e admin editam; convites só o admin vê.
  O gatilho `guard_profile` impede autoaprovação: a própria pessoa só pode pedir entrada (`pending`), cancelar/sair
  ou virar admin da empresa que acabou de criar; o admin só aceita/muda papel (sol/func)/remove membros da empresa dele.
  Reencaixar a agenda (`scheduleWaiting`) só roda no cliente do próprio funcionário.
- No modo local não há RLS: `applyCompanyScope()` (domain/auth.js) filtra tudo por empresa no navegador.
- Mudou o esquema? Edite `supabase/schema.sql` e execute-o de novo (é idempotente).
- Visões para relatórios: `v_tasks`, `v_devices`.

Testes: `pip install playwright && playwright install chromium`, depois
`python tests/smoke.py` e `python tests/e2e.py` (modo local). Rode o e2e após qualquer mudança.
`python tests/supabase_e2e.py` testa contra o Supabase real (usa `~/.supabase-token` para criar as contas de teste
já confirmadas, sem enviar e-mail, e para limpar tudo no final).

## Modelo de dados (coleções do banco)
- `companies/<id>` — `{name, admin(uid), created, cats:[{name,icon}] (criadas), hidden:[] (de fábrica excluídas),
  probs:{categoria:[problema]}, probRec:{categoria:{problema:{n,u}}} (aviso periódico padrão do problema),
  cargos:{chave:{n, cats:[categoria]}}}` (funções e as categorias que cada uma vê),
  `addr:{cep,rua,num,comp,bairro,cidade,uf,ibge}`, `holidays:{ibge, at, years:{AAAA:[{d:'AAAA-MM-DD', n, t:'N'|'E'|'M'|'F', est?}]}}`.
- `invites/<código>` — `{company, role:'sol'|'func', by, created}`. Link: `?convite=<código>` (entra direto, ativo).
- `cred/<id>` — só no modo local: `{salt, hash, aid}` credenciais (PBKDF2 no navegador). `id` = hash do e-mail.
- `profiles/<aid>` — `{name, role:'admin'|'func'|'sol', company, status:'pending'|'active', requestedAt, email, ck,
  theme, seen, start,end,bs,be (jornada),
  off:[{s,e,note}] (folgas pontuais), wk:[0..6] (folga semanal), ws:{cargo,setup,layout}}`.
  `ws.layout` = organização dos aparelhos: `[{type:'dev',id} | {type:'group',id,name,cat?,items:[devId]}]`
  (sem layout, cada categoria vira um grupo — ver `js/domain/layout.js`).
  Solicitante: `devCatOrder:[categoria]` = ordem das categorias na aba Aparelhos.
  Categorias e problemas ficavam no perfil (`ws.cats/hidden/probs/areas`); agora ficam na empresa.
- `tasks/<id>` — `{title,desc,prio:'alta|neutra|baixa',dur,emp,req,status,start,initial,hist[],summary,
  dev,devName,devArea,devIp,devPrev,preset,tipo:'manutencao', pool, cat}`. `devPrev` = status do aparelho antes da tarefa.
  Tarefa aberta para a equipe: `pool:true`, `emp:null`, `cat` = categoria (do aparelho ou escolhida; `null` = geral).
  Status: `aguardando` → `pendente`/`agendada` → `andamento` ⇄ `pausada` → `concluida` | `cancelada`.
  Manutenção periódica: `rec:{n, u:'d'|'m'|'y'}`; a próxima ocorrência nasce `programada` com `want` = data,
  `series` = id da primeira e `dur` herdada.
- `devices/<id>` — `{company, owner (quem cadastrou), name, ip, area, status:'Operacional|Inoperante|Em manutenção|Fora de uso',
  log[], created}`. Aparelho é **da empresa** (não tem responsável fixo).
- `tasks`, `notifs`, `tutorials` também têm `company`.
- `notifs/<id>` — `{to,txt,at}`.
- `tutorials/<id>` — um documento por passo: `{cat,prob,order,img(dataURL),txt,by}`.
- localStorage (fora do banco): `theme`, `accts` (contas salvas), `tm_backend`; modo local: `aid` (sessão);
  Supabase: sessão do Auth, `tm_keep` (manter conectado) e `tm_sessions` (sessões das contas salvas).

**Não renomeie campos nem chaves**: os dados já gravados nos navegadores dependem deles.

## Regras de negócio principais
- Papéis: **admin** (criou a empresa; faz tudo de funcionário e de solicitante + aba Empresa), **func**, **sol**.
- Conta nova → tela de entrada (`views/onboarding.js`): criar empresa (vira admin) ou pedir entrada escolhendo
  papel (fica `pending` até o admin aceitar). Link de convite (`?convite=`) entra direto com o papel do link.
- Empresa recém-criada tem `setup:false`: o admin passa pela etapa **"Aparelhos da empresa"** (`viewCompanySetup()`)
  antes das abas — cadastra aparelhos (ou marca "cadastrar depois") e conclui (`setup:true`). Empresas sem o
  campo são consideradas prontas.
- "Configurações de trabalho" (menu, aba `wcfg`) é **só do funcionário**: vê a sua função, cria categorias, edita
  problemas e exclui categorias **sem aparelhos** (as com aparelhos só o admin). No banco, o gatilho `guard_company`
  deixa o funcionário mudar só categorias/problemas (funções só ganham categorias; nome/admin nunca).
  O admin faz tudo isso na aba Empresa e exclui aparelhos pela janela do aparelho ("Excluir aparelho").
- Excluir conta (Configurações da conta → zona de perigo; senha + digitar "EXCLUIR"): RPC `delete_my_account` —
  tarefas abertas que a pessoa pediu são canceladas, as que executaria voltam a ficar abertas para a equipe;
  o admin só exclui a conta depois de excluir a empresa. Excluir empresa (aba Empresa; senha + digitar o nome):
  RPC `delete_company` — apaga tarefas, aparelhos, tutoriais, convites e notificações da empresa; os membros
  ficam sem empresa (voltam à tela de entrada).
- A aba de aparelhos do funcionário/admin chama-se **"Área de Trabalho"** (chave interna `workstation`).
- Aba Empresa (admin): pedidos de entrada (contador na aba; aceitar com papel e função), membros (trocar papel
  sol/func e função, remover), links de convite, funções (quais categorias cada uma vê) e categorias/problemas.
- Aparelhos são da empresa; funcionário vê/organiza só os das categorias da sua função (`canSeeCategory()`);
  admin e solicitante veem todos. Manutenção: o solicitante escolhe quem atende entre os que cobrem a categoria
  (`eligibleEmployees()`); se só um puder, já vem marcado.
- Tarefa **sem responsável escolhido** vira "aberta para a equipe": aparece para todos que atendem a categoria
  (`canTakeCategory()`: admin sempre; funcionário pela função; sem categoria = qualquer funcionário). O primeiro que
  aceitar (escolhendo a duração) fica com ela — `claimTask()` → RPC `claim_task` (linha travada; recusa se já
  assumida ou se não é da função) — e ela é agendada pela urgência como no aceite normal.
- Solicitante cria a tarefa **sem duração**; só o funcionário define a duração e agenda
  (arrastando o cartão para um horário livre, tocando no cartão e depois no horário, ou botão "Auto").
- Agenda limitada à **semana corrente dentro do mês** (`currentWeek()`); `findSlot()` respeita jornada,
  intervalo, folgas (`off`), folga semanal (`wk`) e tarefas já marcadas.
- Todo encaixe automático segue a urgência (`placeByPriority()`): ao aceitar (botão "Aceitar") e ao reencaixar
  pendentes (`scheduleWaiting()`, ex.: após +15 min, início antecipado, folgas), a tarefa ignora as agendadas
  de urgência menor e ocupa o primeiro horário livre; essas são empurradas para depois, na mesma ordem
  (`pushBackLowerPriority()`). Tarefas iniciadas e as de urgência igual/maior não se mexem (FIFO entre iguais).
  Arrastar para um horário é escolha manual e não reorganiza nada.
- Agenda com visões **Dia / Semana / Mês** (`ui.agendaView`), setas que andam pela unidade da visão, botão "Hoje" e
  campo de data (`#ag_d`) para ir a qualquer data. Qualquer data pode ser **vista**; agendar (horários livres
  clicáveis, arrastar, "Tarefas para agendar") só na semana corrente. Semana/mês mostram as tarefas com horário e as
  periódicas programadas ("Prog."); tocar num dia abre a visão Dia. Campos com `data-live` (valor vindo do estado,
  ex.: data da agenda) não são preservados pelo `renderApp`.
- Agenda: em telas ≥ 900px, agenda à esquerda e painel "Em andamento" fixo à direita (cartão detalhado com
  progresso, tempo decorrido/restante, dados e histórico; atualiza a cada 30 s). No celular o painel fica no topo.
  Clicar no cartão fixo (fora dos botões) rola até a tarefa na agenda e a destaca (`focusTaskInAgenda()`).
  Cartões de tarefa: início → previsão de término no topo, linha, título; só a tarefa em andamento tem a borda
  inteira na cor da prioridade (`.card.running`).
- Encaixe automático nunca usa horário fora do expediente (aceitar depois da saída → primeiro horário do próximo dia
  de trabalho). **Iniciar fora do expediente** (`isOutsideWorkHours()`: antes da entrada, depois da saída, folga,
  ausência ou feriado) pede confirmação (`openStartOutsideHours()`, `#so_ok`) — é o único jeito de a tarefa entrar
  hoje fora do horário. Toque duplo: um 2º toque no mesmo cartão (data-a / data-d / data-claim) em < 0,7 s é
  ignorado (`isDoubleTap()` em app/events.js), pois o cartão é redesenhado e outro botão ocupa o mesmo lugar.
- Uma tarefa em andamento por vez (por funcionário). Iniciar antes do horário puxa a tarefa para agora;
  concluir antes do previsto encurta a duração e libera o horário.
- Tarefa vinculada a aparelho vira "Manutenção"; o relato da conclusão vai para o log do aparelho.
  Status do aparelho (tudo registrado no log): tarefa criada → "Inoperante" (vermelho) até o funcionário iniciar;
  iniciada (andamento/pausada) → "Em manutenção" (amarelo); ao encerrar, se o status ainda for automático
  (Inoperante/Em manutenção): com outra tarefa aberta, segue o que ela pede; sem nenhuma, concluída → "Operacional",
  cancelada/recusada → volta ao `devPrev`. Ver `js/domain/tasks.js` (seção "Status do aparelho vinculado").
- **Manutenção periódica** ("Definir aviso" na Nova tarefa, só com aparelho): intervalo em dias/meses/anos;
  a tarefa é criada já com prioridade **alta** e **não** deixa o aparelho inoperante (só vira "Em manutenção"
  ao iniciar; ao concluir volta a "Operacional"). Ao concluir, `scheduleNextOccurrence()` cria a próxima
  (`programada`, data = conclusão + intervalo; registra no log do aparelho). `activateDueTasks()` (ao receber
  tarefas e a cada 30 s, no navegador do responsável/solicitante) passa a programada para pendente (ou
  aguardando, sem duração/responsável) na semana da data, e ela é encaixada por urgência. Cancelar a
  programada encerra a repetição. Problemas da categoria são editáveis (nome + aviso padrão, `openProblemEdit()` /
  `saveProblem()`; renomear leva junto o tutorial): escolher um problema com aviso já marca a periódica na Nova tarefa.
  **Alerta na Área de Trabalho** (`periodicAlerts()` em domain/devices.js): para cada problema com aviso padrão
  da categoria, se o aparelho não tem tarefa aberta/programada desse problema, conta o prazo desde a última
  conclusão dele (ou desde o cadastro do aparelho) e mostra o aviso no cartão (ponto pulsando, laranja; vermelho
  se atrasado) a partir de metade do intervalo antes do fim, no máximo 30 dias antes (a cada 2 meses → falta 1 mês).
  A ligação é pelo nome do problema (`task.preset`). No banco, o responsável pode inserir a próxima ocorrência (política `tasks_insert`).
- **Endereço e feriados** (`js/domain/holidays.js`): criar a empresa exige CEP + número (ViaCEP preenche rua, bairro,
  cidade, UF e o código IBGE; cidade/UF travadas). Os feriados da cidade (ano atual e o seguinte) vêm do
  feriados-brasil (github.com/joaopbini/feriados-brasil, via jsDelivr: nacional/estadual/municipal/facultativo) e,
  para ano ainda não publicado, da BrasilAPI (nacionais; Carnaval = facultativo) + estaduais/municipais do ano
  anterior projetados (`est:1`, "previsto"; móveis pela Páscoa). Ficam gravados na empresa (`ensureHolidays()`,
  admin/funcionário, recarrega a cada 30 dias ou ao mudar a cidade). Feriado oficial (N/E/M) = dia sem expediente:
  `findSlot`/`fitsAt` pulam, a agenda mostra "Feriado …: nome" e `requeueHolidayTasks()` reagenda as tarefas que
  caírem nele; ponto facultativo (F) só aparece como aviso. Só o admin muda o endereço (aba Empresa; `guard_company`).
- O funcionário define o horário de trabalho (entrada, saída e almoço) em Menu → "Horário de trabalho e folgas"
  (validação: entrada < almoço início < almoço fim < saída).
- **Ausente hoje** (Horário de trabalho e folgas → "Marcar hoje como ausente", com confirmação): `markAbsentToday()`
  grava uma folga só do dia de hoje (`off` com `note:'Ausente'`) e leva as tarefas **agendadas** de hoje para o dia
  seguinte (`want` = amanhã; `placeByPriority`, pulando folgas/feriados; sem vaga na semana → pendente, e
  `scheduleNewWeek()` as encaixa na virada da semana). Iniciadas não se mexem. Desfaz removendo a folga "Ausente".
- Folga nova (semanal ou pontual) ou mudança no horário de trabalho devolve para "pendente" as tarefas
  agendadas que ficarem fora e reagenda automaticamente.
- "Tarefas para agendar" (agenda): mais urgentes primeiro. Em telas ≥ 900px é uma faixa lateral; no celular vira lista
  vertical com as 3 primeiras + "Ver todas (N)" (`ui.showAllWaiting`, `WAITING_PREVIEW`). A aba **Tarefas** mostra um
  contador das que esperam o aceite do usuário (`tasksToAccept()`: enviadas a ele + abertas que ele pode assumir).
- Faixa lateral (telas largas, inclusive tablet): desliza para o lado em qualquer parte do cartão; no toque só a alça ⠿
  (`.drag-handle`) arrasta para um horário (com o mouse, a linha do título `.drag-row` também). `pointercancel` só
  redesenha se havia arrasto (senão interrompia a rolagem); `renderApp` mantém a rolagem das `.strip`.
- O funcionário organiza os aparelhos na Área de Trabalho arrastando (mouse: cartão inteiro; toque: alça ⠿):
  borda de outro aparelho = reordena; meio = cria grupo (ou entra no grupo dele); fora dos grupos = solta.
- Na aba Aparelhos do **solicitante**, os aparelhos de todos aparecem agrupados por categoria; ele só pode
  arrastar as categorias para reordenar (sem mover aparelhos nem desfazer grupos). A ordem é pessoal:
  `profiles/<id>.devCatOrder = [categoria…]` (`requesterCategoryOrder()` / `moveCategory()` em `js/domain/layout.js`).
- Solicitante só enxerga: agenda (outros horários aparecem como "Ocupado"; o admin vê tudo), Equipe, Aparelhos
  (somente leitura).
- Ninguém é notificado das próprias ações (`notify()` ignora o próprio usuário).

## Convenções do código
- Nomes em inglês no código, textos da interface em português.
- `viewXxx()` devolvem o HTML de uma aba; componentes em `views/components.js`.
  Todo texto do usuário/banco passa por `esc()`; `when(cond, html)` e `each(lista, fn)` ajudam a montar HTML.
- `render()` redesenha tudo a partir de `state`/`ui`; não redesenha enquanto há campo de texto em foco
  em `<main>` (fora da Agenda) nem durante arrasto (`ui.drag`). Sem empresa ativa, só mostra a tela de entrada.
- `renderApp()` preserva, na mesma aba, o que a pessoa já preencheu/escolheu e ainda não salvou (o tempo real
  redesenha a tela a qualquer momento). Depois de salvar com sucesso, esvazie os campos com `clearFields(...ids)`.
  A tela de login (`renderLoggedOut()`) também preserva os campos. Login/cadastro e criação/entrada na empresa
  guardam um rascunho na sessão da aba (`tm_draft` em sessionStorage, **sem a senha**; `saveDraft`/`restoreDraft`)
  para sobreviver a recarregar a página no celular (puxar para atualizar — bloqueado por `overscroll-behavior` nessas
  telas — ou aba descartada ao abrir o e-mail); apagado com `clearDraft()` quando dá certo.
- Dados chegam crus em `raw` (domain/auth.js) e `applyCompanyScope()` monta `state`. Quando empresa/status do
  usuário mudam, `startSession()` reabre todas as assinaturas (o que o banco deixa ver mudou).
- Cliques passam por um listener global (`app/events.js`) que despacha para `ACTIONS_BY_ID[btn.id]`
  ou `ACTIONS_BY_DATA[chave do data-*]` (`app/actions.js`). Para um botão novo, adicione a entrada lá.
- Modais: `openModal(html, {wide})` / `closeModal()`; o botão `#dn_no` fecha qualquer modal.
- `say(msg)` mostra um toast; `notify(userId, txt)` cria notificação;
  `commitTask(id, patch, txt)` atualiza tarefa + histórico (e o estado local na hora).
- Ids de elementos com prefixo por tela (`a_` login, `ob_` entrada na empresa, `adm_` aba Empresa, `f_` nova tarefa,
  `dv_` aparelho, `p_`/`em_`/`pw_` conta, `o_` folga, `w_`/`wc_` workstation, `tu_` tutorial) — os testes dependem deles.
- Tema: variáveis CSS em `:root` e `:root[data-theme=dark]`.

## Limitações conhecidas / próximos passos
- Regras de agenda rodam no navegador; o RLS limita quem altera o quê, mas a lógica não é validada no
  servidor. Próximo passo possível: mover ações críticas para funções do banco (RPC).
- Fotos dos tutoriais ficam no jsonb (data URL); para muitas fotos, mover para o Supabase Storage.
- E-mails de confirmação: sem SMTP próprio, o Supabase grátis só envia ~2 e-mails/hora e só para membros da equipe do
  projeto, e não deixa mudar os modelos. Para usuários reais, configurar SMTP próprio (Authentication → Emails → SMTP).
- Só a categoria **Impressora** tem problemas pré-definidos de fábrica; faltam Computador, Raspberry Pi, Orange Pi, Móvel 0–3.
- Tutoriais (Menu ☰ → Tutoriais) estão prontos, mas sem conteúdo.
- Fotos de aparelhos ainda não existem (o cartão usa o ícone da categoria).
