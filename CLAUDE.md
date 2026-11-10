# TASK MANAGER — Agenda Inteligente de Tarefas

Sistema web (mobile-first, funciona no PC) para distribuir tarefas entre **solicitantes (Usuário Y)**
e **funcionários (Usuário X)**, com agenda automática, aparelhos (Workstation), logs e tutoriais.
Idioma da interface e dos textos: **português do Brasil**. Responda ao usuário em português.

## Estrutura
- `index.html` — o sistema inteiro (CSS no topo, HTML mínimo, **um grande `<script>` no final**).
- `local-runtime.js` — banco local (localStorage) que emula `claude.use('db')` e `claude.use('user')`.
  Na versão publicada no claude.ai esse runtime vem do próprio claude.ai; aqui ele é emulado.
- `iniciar.bat` / `iniciar.sh` — sobem `python -m http.server 8000`.
- `tests/smoke.py` — teste de fumaça com Playwright (cadastro + login).

## Como rodar
`python -m http.server 8000` na pasta e abrir http://localhost:8000 (ou extensão Live Server).
Os dados ficam no localStorage do navegador (chave `tm_db_v1`). Para zerar: apagar essa chave.

## Modelo de dados (coleções do banco)
- `cred/<id>` — `{salt, hash, aid}` credenciais (PBKDF2 no navegador). `id` = hash do e-mail.
- `profiles/<aid>` — `{name, role:'func'|'sol', email, ck, theme, seen, start,end,bs,be (jornada),
  off:[{s,e,note}] (folgas pontuais), wk:[0..6] (folga semanal), ws:{cargo,cats,hidden,probs,setup,s1}}`.
  `ws.probs[categoria]` = lista de problemas de manutenção (senão usa `PRESETS`).
- `tasks/<id>` — `{title,desc,prio:'alta|neutra|baixa',dur,emp,req,status,start,initial,hist[],summary,
  dev,devName,devArea,devIp,preset,tipo:'manutencao'}`.
  Status: `aguardando` → `pendente`/`agendada` → `andamento` ⇄ `pausada` → `concluida` | `cancelada`.
- `devices/<id>` — `{owner,name,ip,area,status:'Operacional|Em manutenção|Fora de uso',log[],created}`.
- `notifs/<id>` — `{to,txt,at}`.
- `tutorials/<id>` — um documento por passo: `{cat,prob,order,img(dataURL),txt,by}`.

## Regras de negócio principais
- Solicitante cria a tarefa **sem duração**; só o funcionário define a duração e agenda
  (arrastando o cartão para um horário livre, ou botão "Auto").
- Agenda limitada à **semana corrente dentro do mês** (`WK()`); `findSlot()` respeita jornada, intervalo,
  folgas (`off`), folga semanal (`wk`) e tarefas já marcadas.
- Uma tarefa em andamento por vez (por funcionário). Iniciar antes do horário puxa a tarefa para agora;
  concluir antes do previsto encurta a duração e libera o horário.
- Tarefa vinculada a aparelho vira "Manutenção"; o relato da conclusão vai para o log do aparelho.
- Solicitante só enxerga: agenda (outros horários aparecem como "Ocupado"), Equipe, Aparelhos (somente leitura).

## Convenções do código
- JavaScript puro, sem build. Funções `vXxx()` retornam HTML (string); `render()` monta tudo.
- `render()` não redesenha enquanto há campo de texto em foco (fora da Agenda) nem durante arrasto (`dg`).
- Todo clique passa pelo listener global em `document` (botões com `data-*`); modais reutilizam `#md`/`#mdb`.
- `say(msg)` mostra um toast; `note(userId, txt)` cria notificação; `commit(id,patch,txt)` atualiza tarefa + histórico.
- Há trechos com sequências literais `\uXXXX` dentro de strings JS (ok em tempo de execução).
- Tema: variáveis CSS em `:root` e `:root[data-theme=dark]`.

## Limitações conhecidas / próximos passos
- Login é simulado no navegador; não há servidor. Para uso real com várias máquinas é preciso backend
  (banco + autenticação) e trocar `local-runtime.js` por chamadas à API.
- Só a categoria **Impressora** tem problemas pré-definidos de fábrica; faltam Computador, Raspberry Pi, Orange Pi, Móvel 0–3.
- Tutoriais (Menu ☰ → Tutoriais) estão prontos, mas sem conteúdo.
- Fotos de aparelhos ainda não existem (o cartão usa o ícone da categoria).
