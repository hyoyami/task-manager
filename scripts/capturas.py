"""Capturas de tela do README (docs/img/*.png).

Monta uma empresa de demonstração no modo local (dados fictícios, relógio fixo, CEP e feriados simulados)
e fotografa as principais telas no computador e no celular. Rode de novo quando a interface mudar:

    .venv/bin/python scripts/capturas.py
"""
import pathlib
import sys
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
import e2e  # noqa: E402
from e2e import INDEX, TZ, Run  # noqa: E402  (reaproveita os ajudantes e as APIs simuladas dos testes)

# Feriados reais de São Paulo/SP no lugar dos fictícios dos testes.
H = e2e.H
e2e.HOLIDAYS_2026.update({
    "nacional": [H("01/01/2026", "Ano Novo", "NACIONAL"), H("21/04/2026", "Tiradentes", "NACIONAL"),
                 H("12/10/2026", "Nossa Senhora Aparecida", "NACIONAL"), H("02/11/2026", "Finados", "NACIONAL"),
                 H("15/11/2026", "Proclamação da República", "NACIONAL"), H("20/11/2026", "Consciência Negra", "NACIONAL"),
                 H("25/12/2026", "Natal", "NACIONAL")],
    "estadual": [H("09/07/2026", "Revolução Constitucionalista", "ESTADUAL", "SP")],
    "municipal": [H("25/01/2026", "Aniversário da Cidade", "MUNICIPAL", "SP", 3550308)],
    "facultativo": [H("28/10/2026", "Dia do Servidor Público", "FACULTATIVO", None),
                    H("24/12/2026", "Véspera de Natal (após 14h)", "FACULTATIVO", "")],
})
from playwright.sync_api import sync_playwright  # noqa: E402

OUT = ROOT / "docs" / "img"
DESKTOP = {"width": 1280, "height": 820}
PHONE = {"width": 390, "height": 844}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport=DESKTOP, timezone_id="America/Sao_Paulo", locale="pt-BR")
        pg = ctx.new_page()
        at = lambda h, m=0, d=11: pg.clock.set_fixed_time(datetime(2026, 11, d, h, m, tzinfo=TZ))
        at(8)
        r = Run(pg)
        pg.goto(INDEX)

        def snap(name, sel=None, full=False):
            pg.evaluate("window.scrollTo(0, 0)")
            r.wait(250)
            pg.evaluate("document.querySelector('#toast')?.classList.remove('show')")
            target = pg.locator(sel) if sel else pg
            target.screenshot(path=str(OUT / f"{name}.png"), **({} if sel else {"full_page": full}), animations="disabled")

        # Tela de entrada (antes de existir qualquer conta).
        pg.set_viewport_size(PHONE)
        r.wait()
        snap("login-celular")
        pg.set_viewport_size(DESKTOP)

        # Empresa de demonstração: administradora, funcionário e solicitante.
        r.signup("Marina Costa", "marina@exemplo.com")
        r.create_company("Gráfica Horizonte", [
            ("Impressora", "HP Recepção", "192.168.0.21"),
            ("Impressora", "Epson Financeiro", "192.168.0.22"),
            ("Computador", "PC Atendimento 01", "192.168.0.31"),
            ("Raspberry Pi", "Painel de Senhas", "192.168.0.41"),
        ])
        devs = pg.evaluate("Object.fromEntries(Object.values(state.devices).map(d => [d.name, d.id]))")
        func_link, sol_link = r.invite("func"), r.invite("sol")
        r.logout()
        pg.goto(func_link)
        r.signup("Rafael Lima", "rafael@exemplo.com")
        rafael = pg.evaluate("state.uid")
        r.tab("workstation")
        pg.select_option("#w_c", "ti")  # primeira vez: escolhe a função
        r.click("#w_save")
        r.logout()
        pg.goto(sol_link)
        r.signup("Carlos Mendes", "carlos@exemplo.com")

        def ask(title, desc, prio="neutra", dev=None, problem=None, to=rafael):
            r.click("#nfab")
            if dev:
                pg.select_option("#f_v", devs[dev])
                r.wait()
            if problem:
                r.click(f'[data-pk="{problem}"]')
            if title:
                pg.fill("#f_t", title)
            pg.fill("#f_d", desc)
            pg.select_option("#f_p", prio)
            if to:
                pg.check(f'.f_e[value="{to}"]')
            r.click("#f_go")

        ask(None, "Papel preso na bandeja 2", "alta", "HP Recepção", "Encravamento")
        ask("Instalar pacote Office", "Máquina nova do atendimento", "neutra", "PC Atendimento 01")
        ask("Trocar cabo de rede", "Sala de reuniões, ponto 3", "baixa")
        ask("Atualizar painel", "Painel não mostra a senha atual", "neutra", "Painel de Senhas")
        ask("Configurar e-mail", "Nova colaboradora do financeiro", "neutra")
        ask(None, "Manchas na impressão", "neutra", "Epson Financeiro", "Limpeza", to=None)  # aberta para a equipe
        r.logout()

        # Rafael organiza o dia: aceita, conclui uma tarefa cedo e inicia a urgente.
        r.login("rafael@exemplo.com")
        task_id = lambda t: pg.evaluate(f"allTasks().find(x => x.title === {t!r}).id")
        for title, minutes in [("Manutenção: Encravamento", 45), ("Manutenção: Instalar pacote Office", 60), ("Configurar e-mail", 30),
                               ("Manutenção: Atualizar painel", 60)]:
            tid = task_id(title)
            r.tab("tarefas")
            pg.select_option(f'.dsel[data-i="{tid}"]', str(minutes))
            r.wait(150)
            r.click(f'[data-a="aceitar"][data-i="{tid}"]')
        r.tab("agenda")
        mail = task_id("Configurar e-mail")
        r.click(f'[data-a="iniciar"][data-i="{mail}"]')
        at(8, 25)
        r.click(f'[data-a="concluir"][data-i="{mail}"]')
        pg.fill("#dn_t", "Conta criada e assinatura configurada.")
        r.click("#dn_ok")
        at(8, 30)
        hp = task_id("Manutenção: Encravamento")
        r.tab("agenda")
        r.click(f'[data-a="iniciar"][data-i="{hp}"]')
        at(8, 50)
        r.tab("agenda")
        snap("agenda-desktop")

        # Celular: agenda (painel "Em andamento" no topo) e a lista "Tarefas para agendar".
        pg.set_viewport_size(PHONE)
        r.tab("agenda")
        snap("agenda-celular")
        pg.set_viewport_size(DESKTOP)

        # Visões semana e mês (com feriados da cidade).
        r.click('[data-av="semana"]')
        snap("agenda-semana")
        r.click('[data-av="mes"]')
        snap("agenda-mes")
        r.click('[data-av="dia"]')

        # Área de Trabalho (aparelhos agrupados por categoria, com status).
        r.tab("workstation")
        snap("area-de-trabalho")
        # Janela do aparelho (status e log).
        r.click(f'[data-dev="{devs["HP Recepção"]}"]')
        snap("aparelho-log", "#mdb")
        r.click("#dn_no")

        # Tarefas (filtros) e Equipe.
        r.tab("tarefas")
        snap("tarefas")
        r.logout()

        # Solicitante: nova tarefa com aparelho e manutenção periódica.
        r.login("carlos@exemplo.com")
        r.tab("equipe")
        snap("equipe")
        r.click("#nfab")
        pg.select_option("#f_v", devs["Epson Financeiro"])
        r.wait()
        r.click('[data-pk="Esvaziar Impressora"]')
        pg.check("#f_rc")
        pg.fill("#f_rn", "2")
        r.wait()
        snap("nova-tarefa", "#mdb")
        r.click("#dn_no")
        r.logout()

        # Administradora: aba Empresa (endereço e feriados, membros, convites).
        r.login("marina@exemplo.com")
        r.tab("empresa")
        snap("empresa", full=False)
        # Tema escuro.
        r.menu("perfil")
        r.click('[data-th="dark"]')
        r.tab("agenda")
        pg.select_option("#selEmp", rafael)
        r.wait()
        snap("agenda-escuro")
        b.close()
    print("Capturas em", OUT)


if __name__ == "__main__":
    main()
