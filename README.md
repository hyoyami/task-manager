# TASK MANAGER — Agenda Inteligente de Tarefas

Sistema web para distribuir tarefas entre **solicitantes** e **funcionários**, com agenda
automática, controle de aparelhos (Workstation), logs de manutenção e tutoriais.
Funciona no celular e no computador.

## Funcionalidades

- **Solicitante:** cria tarefas (com ou sem aparelho vinculado), acompanha a agenda da equipe,
  vê a disponibilidade de cada funcionário e o status dos aparelhos.
- **Funcionário:** define a duração e agenda as tarefas (arrastando o cartão para um horário livre
  ou automaticamente), inicia, pausa e conclui com relato.
- **Agenda inteligente:** respeita jornada, intervalo, folgas semanais e pontuais; reorganiza por prioridade.
- **Workstation:** cadastro de aparelhos por categoria, status e histórico (log) de manutenção;
  organização livre arrastando os cartões e criação de grupos soltando um aparelho sobre outro.
- **Tutoriais:** passo a passo com fotos para cada problema de manutenção.
- Notificações, tema claro/escuro e troca rápida entre contas salvas.

## Como rodar

Precisa apenas de Python (ou da extensão Live Server do VS Code):

```bash
python -m http.server 8000
# abra http://localhost:8000
```

Ou execute `iniciar.bat` (Windows) / `iniciar.sh` (Linux/macOS).

Os dados ficam no **localStorage do navegador** (chave `tm_db_v1`), ou seja, cada navegador tem
seu próprio banco. Para uso real em várias máquinas é preciso um backend — veja
[CLAUDE.md](CLAUDE.md#limitações-conhecidas--próximos-passos).

## Estrutura

```
index.html        página (esqueleto + ordem dos scripts)
css/styles.css    estilos e temas
js/runtime/       banco local (emula a API do claude.ai)
js/core/          utilitários, constantes e estado
js/domain/        regras de negócio (agenda, tarefas, aparelhos, autenticação)
js/views/         telas e componentes (geram HTML)
js/app/           renderização, ações dos botões, eventos e inicialização
tests/            testes automatizados (Playwright)
```

JavaScript puro, sem dependências e sem etapa de build. Detalhes de arquitetura, modelo de dados
e convenções estão em [CLAUDE.md](CLAUDE.md).

## Testes

```bash
pip install playwright
playwright install chromium
python tests/smoke.py   # cadastro + login
python tests/e2e.py     # fluxos completos com relógio fixo
```
