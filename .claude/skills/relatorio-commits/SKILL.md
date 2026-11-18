---
name: relatorio-commits
description: Relatório dos commits do dia, da semana, do mês ou de um intervalo de datas (o usuário escolhe), com resumo em português do que foi entregue. Use quando o usuário pedir relatório de commits ou "o que foi feito" num período.
argument-hint: "[dia | semana | mes | AAAA-MM-DD AAAA-MM-DD]"
---

Gere o relatório de commits pedido.

1. Período: use o argumento (`$ARGUMENTS`). Se estiver vazio e o pedido não disser o período, pergunte ao usuário
   com AskUserQuestion: "Qual período do relatório?" — opções **Dia (hoje)**, **Semana (atual)**, **Mês (atual)**
   (o "Outro" serve para um intervalo de datas).
2. Delegue ao agente `relatorio-commits` (ferramenta Agent, `subagent_type: "relatorio-commits"`), passando o período
   escolhido. Se esse tipo de agente não estiver disponível nesta sessão, siga você mesmo as instruções de
   `.claude/agents/relatorio-commits.md`.
3. Mostre ao usuário o resumo e os caminhos dos arquivos salvos (o .md e o PDF diagramado, que é gerado sempre).
