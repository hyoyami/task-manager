---
name: relatorio
description: Relatórios do TASK MANAGER em .md e PDF — commits, usuários (funcionários e solicitantes separados, com desempenho por pessoa), tarefas e produtividade, aparelhos e manutenção, ou jornada (horas extras e ausências) — por dia, semana, mês ou intervalo de datas. Use quando o usuário pedir um relatório ou um resumo de um período.
argument-hint: "[commits | usuarios | tarefas | aparelhos | jornada] [dia | semana | mes | AAAA-MM-DD AAAA-MM-DD] [empresa]"
---

Gere o relatório pedido.

1. Leia o argumento (`$ARGUMENTS`) e o pedido. Se faltar, pergunte com AskUserQuestion (uma pergunta por item que falta):
   - **Tipo**: Usuários (funcionários e solicitantes), Tarefas e produtividade, Aparelhos e manutenção, Jornada (horas extras
     e ausências) — pode marcar vários; Commits também existe (para o "Outro");
   - **Período**: Dia (hoje), Semana (atual), Mês (atual) — o "Outro" serve para um intervalo de datas;
   - **Empresa** (para tarefas, aparelhos e jornada), se houver mais de uma (`python3 scripts/relatorio.py empresas`).
2. Delegue ao agente `relatorios` (ferramenta Agent, `subagent_type: "relatorios"`), passando tipo(s), período e empresa.
   Se esse tipo de agente não estiver disponível nesta sessão, siga você mesmo `.claude/agents/relatorios.md`.
3. Mostre ao usuário o resumo de cada relatório e os caminhos dos arquivos salvos (.md e PDF).
