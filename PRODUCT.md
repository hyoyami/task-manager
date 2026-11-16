# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Produto para várias empresas (SaaS): cada empresa cria sua conta e monta a própria equipe.
Três papéis dentro de cada empresa:

- **Funcionário (técnico)**: executa as tarefas. Usa o sistema tanto no celular, em campo, indo de setor em
  setor atender aparelhos, quanto no computador, na mesa, acompanhando agenda e Workstation — os dois contextos
  com o mesmo peso. Trabalho principal: ver o que vem a seguir, definir duração, aceitar, iniciar, pausar e
  concluir tarefas, registrar o que foi feito no log do aparelho.
- **Solicitante**: pede tarefas (com ou sem aparelho vinculado), acompanha quando serão feitas e o status dos
  aparelhos. Não executa nada.
- **Administrador**: quem criou a empresa. Monta a área de trabalho (aparelhos, categorias, funções, problemas
  de manutenção), aceita pedidos de entrada ou convida por link, define papéis — e também pede e executa tarefas.

## Product Purpose

Distribuir e agendar tarefas entre quem pede e quem executa, sem negociação manual de horário: o solicitante
cria a tarefa sem duração, o funcionário define a duração e a agenda se organiza sozinha respeitando jornada,
almoço, folgas e urgência. Ao mesmo tempo, mantém o inventário de aparelhos da empresa com status e histórico de
manutenção. Sucesso = cada pedido chega a quem pode atendê-lo, encaixado no horário certo, e o estado de cada
aparelho fica sempre visível para todos.

## Positioning

Agenda que se reorganiza pela urgência e inventário de aparelhos no mesmo lugar: abrir uma manutenção já deixa o
aparelho "Inoperante" para todos, iniciá-la o deixa "Em manutenção", e concluir devolve "Operacional" com o
relato no log — sem ninguém atualizar status à mão.

## Operating Context

- Uso diário, várias vezes ao dia, em celular (em campo) e computador (na mesa).
- Semana de trabalho com jornada, intervalo de almoço, folga semanal e folgas pontuais por funcionário.
- Equipe técnica que atende os demais setores da empresa (o cargo de fábrica é TI — Técnico de informática).
- Várias pessoas usando ao mesmo tempo: mudanças aparecem para todos em tempo real.

## Capabilities and Constraints

- Agenda limitada à semana corrente dentro do mês; uma tarefa em andamento por vez por funcionário.
- Prioridades: alta, neutra, baixa. Status da tarefa: aguardando aceite → pendente/agendada → em andamento ⇄
  pausada → concluída | cancelada.
- Aparelhos são da empresa; cada função (cargo) enxerga só as categorias de aparelho dela. Status do aparelho:
  Operacional, Inoperante, Em manutenção, Fora de uso.
- Tutoriais passo a passo (com fotos) por categoria e problema de manutenção.
- Notificações, tema claro/escuro, troca rápida entre contas salvas no aparelho.
- Interface e textos em **português do Brasil**.
- Técnico: JavaScript puro sem build, back-end Supabase (PostgreSQL, Auth, Realtime, RLS); modo local para
  desenvolvimento e testes. Ver CLAUDE.md.
- Em aberto: cobrança/planos do SaaS, hospedagem pública do site.

## Brand Commitments

- Nome definitivo: **TASK MANAGER**.

## Evidence on Hand

Nenhuma. Não há clientes, depoimentos, números de uso, preços ou estudos de caso — não inventar.

## Product Principles

1. **A agenda trabalha pelo usuário**: encaixe e reorganização automáticos pela urgência; ação manual só quando
   for escolha (arrastar para um horário).
2. **O estado real é visível para todos**: status de tarefa e de aparelho derivados do que acontece, em tempo
   real, sem atualização manual.
3. **Cada papel vê o que precisa**: o funcionário vê o seu trabalho e as categorias da sua função; o solicitante
   vê quando será atendido; o administrador vê a empresa inteira.
4. **Funciona igual no campo e na mesa**: nenhuma tarefa essencial depende de tela grande ou de mouse.
5. **Empresas isoladas**: os dados de uma empresa nunca aparecem para outra.
