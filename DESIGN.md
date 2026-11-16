---
name: TASK MANAGER
description: Agenda de tarefas e inventário de aparelhos para equipes técnicas — sóbria, monocromática, cor só quando significa algo.
colors:
  papel: "#f1f1f1"
  folha: "#ffffff"
  tinta: "#161616"
  lapis: "#6a6a6a"
  risco: "#dedede"
  carvao: "#262626"
  sobre-carvao: "#ffffff"
  carvao-suave: "#ececec"
  lacuna: "#f6f6f6"
  urgencia-alta: "#dc2626"
  urgencia-neutra: "#d97706"
  urgencia-baixa: "#2f9e6b"
  status-operacional: "#22c55e"
  status-manutencao: "#f59e0b"
  status-parado: "#ef4444"
  noite-papel: "#0a0a0a"
  noite-folha: "#141414"
  noite-tinta: "#eaeaea"
  noite-lapis: "#8e8e8e"
  noite-risco: "#262626"
  noite-carvao: "#d6d6d6"
  noite-sobre-carvao: "#0a0a0a"
  noite-carvao-suave: "#1f1f1f"
  noite-lacuna: "#101010"
  noite-urgencia-alta: "#ef4444"
  noite-urgencia-neutra: "#f59e0b"
  noite-urgencia-baixa: "#34b97d"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "3px"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    letterSpacing: "0.3px"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  numeral:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.2
  caption:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.4px"
rounded:
  handle: "8px"
  field: "9px"
  card: "14px"
  device: "18px"
  group: "20px"
  pill: "99px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  card: "12px"
  page: "14px"
  lg: "16px"
components:
  button:
    backgroundColor: "{colors.folha}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.field}"
    padding: "9px 11px"
  button-hover:
    backgroundColor: "{colors.carvao-suave}"
  button-primary:
    backgroundColor: "{colors.carvao}"
    textColor: "{colors.sobre-carvao}"
    rounded: "{rounded.field}"
    padding: "9px 11px"
  button-small:
    typography: "{typography.label}"
    rounded: "{rounded.field}"
    padding: "6px 10px"
  button-danger:
    backgroundColor: "{colors.folha}"
    textColor: "{colors.urgencia-alta}"
    rounded: "{rounded.field}"
  input:
    backgroundColor: "{colors.folha}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.field}"
    padding: "9px 11px"
  card:
    backgroundColor: "{colors.folha}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  tag:
    backgroundColor: "{colors.carvao-suave}"
    textColor: "{colors.tinta}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  slot-livre:
    backgroundColor: "{colors.lacuna}"
    textColor: "{colors.lapis}"
    rounded: "{rounded.card}"
    padding: "8px 12px"
  nav-item:
    textColor: "{colors.lapis}"
    padding: "12px 4px"
  nav-item-active:
    textColor: "{colors.carvao}"
  fab:
    backgroundColor: "{colors.carvao}"
    textColor: "{colors.sobre-carvao}"
    rounded: "{rounded.pill}"
    size: "56px"
  device-card:
    backgroundColor: "{colors.folha}"
    rounded: "{rounded.device}"
    padding: "18px 14px"
---

# Design System: TASK MANAGER

## Overview

**Creative North Star: "A Prancheta de Turno"**

O TASK MANAGER é a prancheta que o técnico leva no turno: papel cinza-claro, folhas brancas presas com bordas
finas, anotações em tinta escura, e cor só onde a cor significa alguma coisa. Ela não decora: cada tom saturado
na tela é uma informação — a urgência de uma tarefa, o estado de um aparelho, um atraso. Todo o resto é
monocromático, em grafite e carvão, para que esses sinais sejam lidos de relance, no corredor ou na mesa.

A densidade é de ferramenta de trabalho: cartões empilhados com respiro curto (10px entre eles), textos em 13–15px,
horários em destaque numérico. A mesma prancheta funciona no celular e no computador; no computador ela se abre
em duas colunas (a agenda à esquerda, a tarefa em execução presa à direita), sem mudar de identidade. Existe um
modo noturno completo, que inverte a prancheta (papel quase preto, tinta clara) mantendo as mesmas regras de cor.

**Key Characteristics:**
- Monocromático por padrão; cor reservada a urgência (alta/neutra/baixa) e status de aparelho.
- Folhas brancas sobre papel cinza, separadas por fio de 1px — profundidade por camada, não por sombra.
- Fonte do sistema, sem família de marca; hierarquia por peso e tamanho, com horários em numeral bold.
- Cantos suaves que crescem com o tamanho do objeto (9px campo → 14px cartão → 18–20px aparelho/grupo).
- Tema claro e escuro equivalentes, trocados por `data-theme` na raiz.

## Colors

Paleta de papelaria em tons neutros, com três cores de urgência e três de status como únicos sinais saturados.

### Primary
- **Carvão** (claro: carvao / escuro: noite-carvao): a única cor "de marca". Botão principal, aba ativa da
  navegação, botão flutuante "+", contorno de foco, selo "Nova" das notificações. Vira cinza-claro no tema escuro
  para manter o contraste invertido.
- **Carvão Suave** (carvao-suave / noite-carvao-suave): fundo de hover dos botões, das etiquetas e da alça de
  arrastar; o "lápis passado de leve".

### Secondary
- **Urgência Alta** (urgencia-alta): prioridade alta (faixa lateral do cartão), botões e textos de perigo
  (Cancelar, Recusar, Excluir), mensagens de erro, contador de notificações.
- **Urgência Neutra** (urgencia-neutra): prioridade neutra.
- **Urgência Baixa** (urgencia-baixa): prioridade baixa.

### Tertiary
- **Operacional** (status-operacional), **Em manutenção** (status-manutencao), **Parado** (status-parado — usado
  por "Inoperante" e "Fora de uso"): só no ponto luminoso de status dos aparelhos (com brilho de 8px da própria
  cor) e na disponibilidade da equipe.

### Neutral
- **Papel** (papel): fundo da página — a prancheta.
- **Folha** (folha): fundo de cartões, campos, botões, modais e barras fixas.
- **Tinta** (tinta): todo texto principal.
- **Lápis** (lapis): textos secundários (13px), rótulos de campo, abas inativas.
- **Risco** (risco): fio de 1px de cartões, campos, divisórias e barras.
- **Lacuna** (lacuna): horários livres da agenda, com borda tracejada.

### Named Rules
**The Cor-é-Dado Rule.** Cor saturada só aparece quando carrega informação: urgência, status de aparelho, perigo
ou atraso. Se a cor não muda o que a pessoa faz, ela é cinza.

**The Faixa de Urgência Rule.** A urgência de uma tarefa é uma faixa de 4px na borda esquerda do cartão; só a
tarefa *em andamento* ganha a borda inteira na cor da urgência (2px, com halo de 3px a 18%).

## Typography

**Display Font:** system-ui (com -apple-system, Segoe UI, sans-serif)
**Body Font:** system-ui (mesma pilha)

**Character:** sem família de marca — a fonte nativa de cada aparelho, para parecer ferramenta do próprio
telefone/computador. A hierarquia vem de peso e tamanho, nunca de troca de família.

### Hierarchy
- **Display** (700, 24px, espaçamento 3px, caixa alta no texto): só a marca "TASK MANAGER" na tela de entrada; no
  cabeçalho a marca usa o mesmo tratamento em 15px com espaçamento 2px.
- **Headline** (700, 19px, espaçamento 0.3px): título de cada aba ("Área de Trabalho", "Empresa").
- **Title** (700, 16px): seções dentro da aba e títulos de modal; o título da tarefa em execução sobe para 20px.
- **Body** (400, 15px, 1.4): texto corrido, campos, botões padrão.
- **Label** (400, 13px, cor Lápis): rótulos de campo, linhas de detalhe, botões pequenos.
- **Numeral** (700, 17px; 22px no painel da tarefa em execução): horários de início → previsão de término.
- **Caption** (11px): etiquetas (status, prioridade), e rótulos em CAIXA ALTA com espaçamento 0.4px sobre os
  horários ("INÍCIO", "PREVISÃO DE TÉRMINO").

### Named Rules
**The Hora-em-Negrito Rule.** Horários são o dado mais consultado: sempre em numeral bold, à frente do título,
com o rótulo em caption acima. O resto do cartão é texto de 13–15px.

**The Nome-de-Aparelho Rule.** O nome do aparelho no cartão é o único texto em caixa alta pesada (800, 19px,
espaçamento 0.5px) — funciona como a etiqueta física colada no equipamento.

## Layout

Coluna única centrada (até 760px) com margem de 14px; no celular a navegação é uma barra fixa embaixo
(abas de largura igual) e o cabeçalho de 48px fica fixo em cima, respeitando a área segura do aparelho.
A partir de 900px a navegação sobe para baixo do cabeçalho (abas de 120px, centralizadas) e a aba Agenda se abre
em duas colunas (até 1180px): agenda à esquerda e o painel "Em andamento" (320–400px) preso à direita, que
acompanha a rolagem. Ritmo vertical curto: 10px entre cartões, 8px entre itens de uma linha, 16px antes de cada
seção. Grades de aparelhos usam colunas automáticas de no mínimo 260px. Formulários de horário usam duas colunas.

## Elevation & Depth

Sistema essencialmente plano: a profundidade vem da camada (folha branca sobre papel cinza) e do fio de 1px.
No tema claro os cartões têm uma sombra quase imperceptível; no escuro, nenhuma. Sombras marcadas existem só
para o que flutua sobre a página: botão "+", cartão sendo arrastado, avisos que surgem no canto.

### Shadow Vocabulary
- **Papel** (`box-shadow: 0 1px 3px rgba(0,0,0,.05)`): cartões no tema claro; `none` no escuro.
- **Flutuante** (`box-shadow: 0 6px 18px rgba(0,0,0,.3)`): botão "+".
- **Arrastando** (`box-shadow: 0 8px 24px rgba(0,0,0,.3)`): fantasma do cartão durante o arrasto.
- **Aviso** (`box-shadow: 0 8px 28px rgba(0,0,0,.22)` + vidro fosco de 12px): pop-ups de notificação nova.
- **Halo de urgência** (`box-shadow: 0 0 0 3px` da cor da urgência a 18%): tarefa em andamento.

### Named Rules
**The Plano-até-Flutuar Rule.** Nada ganha sombra por enfeite. Se o elemento não está literalmente acima da
página (flutuando, sendo arrastado, aparecendo por cima), ele é plano com fio de 1px.

## Shapes

Cantos suaves e proporcionais ao tamanho: campos e botões 9px, cartões e modais 14px, cartões de aparelho 18px,
grupos de aparelhos 20px, etiquetas e o botão "+" totalmente arredondados. Bordas são fios sólidos de 1px; a
única borda tracejada é o horário livre da agenda (uma lacuna a preencher). Avatares são círculos com a inicial
em branco sobre uma cor derivada do id da pessoa.

## Components

### Buttons
Discretos e precisos na mesa; em campo, devem ser fáceis de acertar com o dedo (ver Do's).
- **Shape:** cantos suaves (9px), fio de 1px.
- **Padrão:** fundo Folha, texto Tinta, 9px × 11px; hover passa para Carvão Suave (transição de 0.15s).
- **Principal:** fundo e fio Carvão, texto Sobre-Carvão. Um por contexto (Salvar, Aceitar, Concluir, Iniciar).
- **Pequeno:** 6px × 10px em 13px — ações dentro de cartões.
- **Perigo:** texto em Urgência Alta (Cancelar, Recusar, Excluir); "Excluir" definitivo em modal usa fundo
  vermelho cheio; o "✕" de remover item usa fio e texto vermelhos em 700.

### Chips (Tags)
- **Style:** pílula (99px) com fundo Carvão Suave, texto Tinta em 11px, fio de 1px.
- **State:** informativas, não clicáveis — status da tarefa, prioridade, "Manutenção", categoria, "Administrador".

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Folha sobre Papel.
- **Shadow Strategy:** sombra "Papel" (ver Elevation).
- **Border:** fio Risco de 1px; tarefas somam a faixa de urgência de 4px à esquerda.
- **Internal Padding:** 12px (16px no painel da tarefa em execução).

### Inputs / Fields
- **Style:** fundo Folha, fio Risco, 9px de canto, largura total; rótulo em 13px Lápis acima.
- **Focus:** contorno de 2px em Carvão e fio Carvão.
- **Error:** mensagem em Urgência Alta abaixo do formulário.

### Navigation
- **Celular:** barra fixa inferior, fundo Folha, fio superior; abas em 12px Lápis; a ativa fica Carvão, em 600,
  com traço interno de 2px no topo. Contador vermelho (pílula de 10px) em abas com pendências.
- **Computador (≥ 900px):** a mesma barra sobe para logo abaixo do cabeçalho, abas de 120px centralizadas.
- **Gavetas laterais** (menu e notificações): até 340px à direita, sobre um véu escuro, deslizando em 0.22s.

### Cartão de Tarefa (signature)
O cartão mais lido do sistema. Topo: horário de **Início → Previsão de término** em numeral bold com rótulos
em caption, duração à direita; um fio separa o topo do título; abaixo, etiquetas, descrição em Lápis e as ações.
A previsão é sempre início + duração, então acompanha o +15/−15 min. Em andamento: borda inteira na cor da
urgência com halo. No painel fixo, ganha barra de progresso de 8px na cor da urgência, "Em execução há…" e
"Faltam…" (ou "Atrasada…" em vermelho).

### Cartão de Aparelho (signature)
Folha de 18px, centralizada: nome em caixa alta pesada, ícone grande da categoria (emoji de 76px ou PNG de 96px),
IP em bold 17px, linha de status com ponto luminoso colorido (10px, brilho de 8px) e o botão de log. Agrupados em
seções de canto 20px com fundo Folha a 45% sobre o Papel. Alça "⠿" no canto para arrastar.

### Horário Livre
Faixa de Lacuna com borda tracejada e texto Lápis ("09:30 · livre"); ao receber um cartão arrastado, ganha
contorno Carvão de 2px e fundo Carvão Suave.

## Do's and Don'ts

### Do:
- **Do** manter a tela monocromática e usar Urgência/Status só para sinalizar (The Cor-é-Dado Rule).
- **Do** mostrar urgência pela faixa de 4px à esquerda; borda inteira só para a tarefa em andamento.
- **Do** pôr horários em numeral bold no topo do cartão, antes do título.
- **Do** usar fio de 1px Risco para separar folhas e seções; sombra só para o que flutua.
- **Do** definir toda cor nova como token no `:root` e no `:root[data-theme=dark]` — os dois temas são obrigatórios.
- **Do** escalar os cantos com o tamanho do objeto (9 → 14 → 18 → 20px; pílula para etiquetas).
- **Do** (diretriz, a consolidar) deixar componentes discretos na tela grande e mais táteis no celular: alvos de
  toque com pelo menos 44px de altura em ações de campo (Iniciar, Concluir, Aceitar).

### Don't:
- **Don't** usar cor de destaque fora do Carvão; não há azul, roxo ou cor de marca.
- **Don't** usar emojis em textos, frases e etiquetas — o emoji é só o ícone de uma categoria, e aparece apenas
  onde a categoria é o próprio assunto (cartão de aparelho, cabeçalho de grupo, lista de categorias).
- **Don't** trocar a fonte do sistema por uma família web; a hierarquia vem de peso e tamanho.
- **Don't** criar sombras decorativas em cartões ou botões (The Plano-até-Flutuar Rule).
- **Don't** usar borda tracejada para nada além de horários livres.
