"""Teste ponta a ponta do TASK MANAGER (Playwright + banco local).

Percorre os fluxos principais com o relógio do navegador fixo (quarta-feira,
11/11/2026, 09:00 em São Paulo) para que o resultado seja determinístico:

  funcionário: cadastro, configuração da Área de Trabalho, aparelho, folgas,
               problemas da categoria, tutorial;
  solicitante: cadastro, Equipe, Aparelhos, criação de tarefas (com e sem aparelho);
  funcionário: aceite automático, agendamento por toque, início antecipado,
               conclusão com relato (vai para o log do aparelho), cancelamento;
  ambos:       notificações, tema, histórico.

Requer:  pip install playwright && playwright install chromium
Uso:     python tests/e2e.py              (executa e valida)
         python tests/e2e.py --dump out.json   (também grava telas + banco p/ comparação)
         python tests/e2e.py --shots pasta/    (também salva capturas de tela PNG)
"""
import base64
import json
import pathlib
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
INDEX = (ROOT / "index.html").as_uri() + "?backend=local"  # testes usam o banco local
TZ = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2026, 11, 11, 9, 0, tzinfo=TZ)


def ms(h, m=0, day=11):
    return int(datetime(2026, 11, day, h, m, tzinfo=TZ).timestamp() * 1000)


# ---------- APIs externas simuladas (CEP e feriados), para o teste não depender da internet ----------
CEPS = {
    "01001000": {"cep": "01001-000", "logradouro": "Praça da Sé", "bairro": "Sé", "localidade": "São Paulo", "uf": "SP", "ibge": "3550308"},
    "20040002": {"cep": "20040-002", "logradouro": "Rua da Assembleia", "bairro": "Centro", "localidade": "Rio de Janeiro", "uf": "RJ", "ibge": "3304557"},
}
H = lambda d, n, t, uf=None, ibge=None: {"data": d, "nome": n, "tipo": t, "descricao": "", "uf": uf, "codigo_ibge": ibge}
HOLIDAYS_2026 = {
    "nacional": [H("01/01/2026", "Ano Novo", "NACIONAL"), H("15/11/2026", "Proclamação da República", "NACIONAL"),
                 H("20/11/2026", "Consciência Negra", "NACIONAL"), H("25/12/2026", "Natal", "NACIONAL")],
    "estadual": [H("09/07/2026", "Revolução Constitucionalista", "ESTADUAL", "SP"), H("23/04/2026", "São Jorge", "ESTADUAL", "RJ")],
    "municipal": [H("25/01/2026", "Aniversário da Cidade", "MUNICIPAL", "SP", 3550308),
                  H("12/11/2026", "Feriado de Teste", "MUNICIPAL", "RJ", 3304557),
                  H("04/06/2026", "Corpus Christi", "MUNICIPAL", "RJ", 3304557)],
    "facultativo": [H("13/11/2026", "Dia do Ponto Facultativo", "FACULTATIVO", ""),
                    H("14/12/2026", "Aniversário de Outra Cidade", "FACULTATIVO", "SP")],
}
BRASILAPI_2027 = [{"date": "2027-01-01", "name": "Confraternização mundial", "type": "national"},
                  {"date": "2027-02-09", "name": "Carnaval", "type": "national"}]


def mock_apis(page):
    def viacep(route):
        cep = route.request.url.split("/ws/")[1].split("/")[0]
        route.fulfill(json=CEPS.get(cep, {"erro": "true"}), headers={"Access-Control-Allow-Origin": "*"})

    def dataset(route):
        kind, _, year = route.request.url.split("/dados/feriados/")[1].replace(".json", "").split("/")
        if year == "2026":
            route.fulfill(json=HOLIDAYS_2026[kind], headers={"Access-Control-Allow-Origin": "*"})
        else:
            route.fulfill(status=404, body="Not found", headers={"Access-Control-Allow-Origin": "*"})

    def brasilapi(route):
        year = route.request.url.rstrip("/").split("/")[-1]
        route.fulfill(json=BRASILAPI_2027 if year == "2027" else [], headers={"Access-Control-Allow-Origin": "*"})

    page.route("**/viacep.com.br/ws/**", viacep)
    page.route("**/cdn.jsdelivr.net/gh/joaopbini/feriados-brasil@master/dados/feriados/**", dataset)
    page.route("**/brasilapi.com.br/api/feriados/**", brasilapi)


class Run:
    def __init__(self, page, shots_dir=None):
        self.pg = page
        self.shots_dir = shots_dir
        self.shots = []
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        # 404 de um ano de feriados ainda não publicado é esperado (o app usa a BrasilAPI no lugar).
        page.on("console", lambda m: m.type == "error" and "status of 404" not in m.text and self.errors.append(m.text))
        page.on("dialog", lambda d: d.accept())  # confirm() de exclusões
        mock_apis(page)

    def wait(self, t=120):
        self.pg.wait_for_timeout(t)

    def shot(self, label, sel="#app", full_page=True):
        self.wait()
        txt = self.pg.inner_text(sel)
        self.shots.append({"label": label, "text": re.sub(r"[ \t]+", " ", txt).strip()})
        if self.shots_dir:
            n = len(self.shots)
            self.pg.screenshot(path=str(self.shots_dir / f"{n:02d}-{label}.png"), full_page=full_page, animations="disabled")
        return txt

    def click(self, sel):
        # Botões de tarefa: o app ignora um 2º toque no mesmo cartão em < 0,7 s (proteção contra toque duplo).
        if "data-a=" in sel or "data-claim=" in sel or "data-d=" in sel:
            import time
            gap = time.monotonic() - getattr(self, "_last_task_click", 0)
            if gap < 0.75:
                self.pg.wait_for_timeout(int((0.75 - gap) * 1000))
            self._last_task_click = time.monotonic()
        self.pg.click(sel)
        self.wait()

    def tab(self, key):
        self.click(f'nav [data-tab="{key}"]')

    def menu(self, go):
        self.click("#mnb")
        self.click(f'#mn_b [data-go="{go}"]')

    def signup(self, name, email):
        """Cria a conta. Sem convite cai na tela de entrada na empresa; com convite, já entra."""
        pg = self.pg
        pg.wait_for_selector("#a_go")
        if not pg.query_selector("#a_n"):
            self.click("#a_mode")
        pg.fill("#a_n", name)
        pg.fill("#a_u", email.split("@")[0])
        pg.fill("#a_e", email)
        pg.fill("#a_p", "123456")
        pg.check("#a_k")
        self.click("#a_go")
        pg.wait_for_selector("nav button, #ob_cn, #ob_cancel")
        self.wait(250)

    def fill_address(self, prefix="ob", cep="01001000", num="100"):
        """CEP → rua/bairro/cidade/UF preenchidos sozinhos; o número a pessoa digita."""
        self.pg.fill(f"#{prefix}_cep", cep)
        self.pg.wait_for_function(f"document.querySelector('#{prefix}_cid').value !== ''")
        self.pg.fill(f"#{prefix}_num", num)

    def create_company(self, name, devices=(), cep="01001000"):
        """Cria a empresa e passa pela etapa "Aparelhos da empresa" (cadastrando `devices` ou pulando)."""
        self.pg.fill("#ob_cn", name)
        self.fill_address(cep=cep)
        self.click("#ob_create")
        self.pg.wait_for_selector("#cs_done")
        for area, dev_name, ip in devices:
            self.pg.select_option("#dv_a", area)
            self.pg.fill("#dv_n", dev_name)
            self.pg.fill("#dv_i", ip)
            self.click("#dv_add")
        if not devices:
            self.pg.check("#cs_skip")
        self.click("#cs_done")
        self.pg.wait_for_selector("nav button")

    def invite(self, role):
        """Gera um link de convite na aba Empresa (administrador) e devolve a URL."""
        self.tab("empresa")
        self.pg.select_option("#adm_ir", role)
        self.click("#adm_inv")
        code = self.pg.evaluate(f"Object.entries(state.invites).find(([k, v]) => v.role === '{role}')[0]")
        return self.pg.evaluate(f"inviteLink('{code}')")

    def uid_of(self, email):
        db = json.loads(self.pg.evaluate("localStorage.getItem('tm_db_v1')"))
        return next(k.split("/", 1)[1] for k, v in db.items() if k.startswith("profiles/") and v.get("email") == email)

    def login(self, email, password="123456"):
        pg = self.pg
        pg.wait_for_selector("#a_go")
        if pg.query_selector("#a_n"):
            self.click("#a_mode")
        pg.fill("#a_e", email)
        pg.fill("#a_p", password)
        self.click("#a_go")
        pg.wait_for_selector("nav button")
        self.wait()

    def logout(self):
        self.click("#mnb")
        self.click("#a_out")
        self.pg.wait_for_selector("#a_go")

    def tabs(self):
        return self.pg.eval_on_selector_all("nav button", "e => e.map(x => x.textContent)")

    def db(self):
        raw = json.loads(self.pg.evaluate("localStorage.getItem('tm_db_v1')"))
        rand = {k.split("/", 1)[1] for k in raw if not k.startswith(("cred/", "profiles/"))}
        out = {}
        for k, v in raw.items():
            col = k.split("/", 1)[0]
            if col == "cred":
                v = {**v, "salt": "<salt>", "hash": "<hash>"}
            s = json.dumps(v, sort_keys=True, ensure_ascii=False)
            for r in rand:
                s = s.replace(r, "<ID>")
            out.setdefault(col, []).append(s)
        return {c: sorted(v) for c, v in sorted(out.items())}


def main():
    arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
    dump, shots_dir = arg("--dump"), arg("--shots")
    if shots_dir:
        shots_dir = pathlib.Path(shots_dir)
        shots_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 420, "height": 900}, timezone_id="America/Sao_Paulo", locale="pt-BR")
        pg = ctx.new_page()
        pg.clock.set_fixed_time(NOW)
        r = Run(pg, shots_dir)
        pg.goto(INDEX)
        r.shot("login")

        # ---------- Administrador Carlos: cria a empresa, problemas e convites ----------
        r.signup("Carlos", "carlos@teste.com")
        r.shot("onboarding")
        r.click("#ob_create")
        assert "nome da empresa" in pg.inner_text("#toast")
        r.create_company("Empresa Teste")
        assert r.tabs() == ["Agenda", "Tarefas", "Equipe", "Área de Trabalho", "Empresa"], r.tabs()
        r.tab("empresa")
        r.click('[data-cat="Impressora"]')
        pg.fill("#pb_n", "Sem tinta")
        r.click("#pb_add")
        r.shot("cat-modal", "#mdb")
        r.click("#dn_no")
        func_link = r.invite("func")
        sol_link = r.invite("sol")
        r.shot("empresa")
        r.logout()

        # ---------- Funcionária Ana: entra pelo convite e monta a Área de Trabalho ----------
        pg.goto(func_link)
        assert "convite" in pg.inner_text("#app")
        r.signup("Ana", "ana@teste.com")
        assert r.tabs() == ["Agenda", "Tarefas", "Área de Trabalho"], r.tabs()
        ana_id = pg.evaluate("state.uid")
        r.shot("ana-agenda-vazia")
        r.tab("workstation")
        r.shot("ws-funcao")
        pg.select_option("#w_c", "ti")
        r.click("#w_save")
        r.click('[data-wst="new"]')
        pg.select_option("#dv_a", "Impressora")
        pg.fill("#dv_n", "HP Recepção")
        pg.fill("#dv_i", "192.168.0.300")
        r.click("#dv_add")  # IP inválido -> recusado
        assert "IP v" in pg.inner_text("#toast")
        pg.fill("#dv_i", "192.168.0.10")
        r.click("#dv_add")
        r.shot("ws-lista")
        dev_id = pg.get_attribute("[data-dev]", "data-dev")
        r.click(f'[data-dev="{dev_id}"]')
        pg.select_option(".dv_st", "Fora de uso")
        r.wait()
        pg.fill("#dv_t", "Troca de toner")
        r.click(f'[data-lg="{dev_id}"]')
        r.shot("dev-modal", "#mdb")
        r.click("#dn_no")

        # Configurações de trabalho (funcionário): cria categoria e problema; categoria com aparelho não se exclui.
        r.menu("wcfg")
        pg.fill("#wc_n", "Scanner")
        pg.set_input_files("#wc_f", files=[{"name": "s.png", "mimeType": "image/png", "buffer": PNG_1PX}])
        r.click("#wc_add")
        r.wait(300)
        assert pg.locator('[data-cat="Scanner"]').count() == 1
        r.click('[data-cat="Scanner"]')
        pg.fill("#pb_n", "Sem papel")
        r.click("#pb_add")
        assert "Sem papel" in pg.inner_text("#mdb")
        r.click("#dn_no")
        assert pg.locator('[data-cdel="Impressora"]').count() == 0   # tem aparelho: só o admin exclui
        assert pg.locator('[data-cdel="Scanner"]').count() == 1      # vazia: o funcionário pode excluir
        r.shot("wcfg")

        # Folgas: sábado e domingo + folga pontual
        r.menu("folgas")
        pg.check('.wk[value="0"]')
        pg.check('.wk[value="6"]')
        r.click("#wk_go")
        pg.fill("#o_s", "2026-11-13")
        pg.fill("#o_e", "2026-11-13")
        pg.fill("#o_n", "Consulta")
        r.click("#o_go")
        r.wait(1000)
        r.shot("folgas")

        # Perfil: jornada
        r.menu("perfil")
        pg.fill("#p_n", "Ana Souza")
        r.click("#p_go")
        r.shot("perfil")

        # Tutorial
        r.menu("tutoriais")
        r.shot("tutoriais")
        r.click('[data-tut="Impressora||Limpeza"]')
        pg.fill("#tu_t", "Desligue a impressora.")
        r.click("#tu_add")
        pg.fill("#tu_t", "Limpe o cabeçote.")
        r.click("#tu_add")
        first = pg.get_attribute("[data-tmv]", "data-tmv").split("|")[0]
        r.click(f'[data-tmv="{first}|1"]')
        r.shot("tutorial-modal", "#mdb")
        r.click("#dn_no")

        # Tema escuro
        r.menu("perfil")
        r.click('[data-th="dark"]')
        assert pg.evaluate("document.documentElement.dataset.theme") == "dark"
        r.click('[data-th="light"]')
        r.logout()

        # ---------- Solicitante Bruno (convite) ----------
        pg.goto(sol_link)
        r.signup("Bruno", "bruno@teste.com")
        assert r.tabs() == ["Agenda", "Tarefas", "Equipe", "Aparelhos"], r.tabs()
        r.shot("bruno-agenda")
        r.tab("equipe")
        r.shot("equipe")
        r.tab("aparelhos")
        r.shot("aparelhos")
        pg.select_option("#af_s", "Operacional")
        r.shot("aparelhos-filtro")
        pg.select_option("#af_s", "")
        r.click(f'[data-rodev="{dev_id}"]')
        r.shot("aparelho-ro", "#mdb")
        r.click("#dn_no")

        # Tarefa simples (validação + envio)
        r.click("#nfab")
        r.click("#f_go")
        assert "Informe" in pg.inner_text("#f_m")
        pg.fill("#f_t", "Instalar Office")
        pg.fill("#f_d", "Notebook do financeiro")
        pg.check(f'.f_e[value="{ana_id}"]')
        pg.select_option("#f_p", "alta")
        r.click("#f_go")
        # Tarefa de manutenção (aparelho + problema pré-definido)
        r.click("#nfab")
        pg.select_option("#f_v", dev_id)
        r.wait()
        r.shot("nova-com-aparelho", "#mdb")
        r.click('[data-pk="Limpeza"]')
        pg.check(f'.f_e[value="{ana_id}"]')
        r.click("#f_go")
        # O aparelho vinculado fica inoperante até o funcionário iniciar (visível na aba Aparelhos).
        assert device_status(r, dev_id) == "Inoperante"
        r.tab("aparelhos")
        assert "status: inoperante" in pg.inner_text(f'.device-card[data-did="{dev_id}"]')
        # Terceira tarefa, que será cancelada pelo solicitante
        r.click("#nfab")
        pg.fill("#f_t", "Trocar mouse")
        pg.fill("#f_d", "Mouse quebrado")
        pg.check(f'.f_e[value="{ana_id}"]')
        pg.select_option("#f_p", "baixa")
        r.click("#f_go")
        r.tab("tarefas")
        r.shot("bruno-tarefas")
        cancel_id = pg.eval_on_selector_all(
            "[data-tid]", "e => e.find(x => x.textContent.includes('Trocar mouse')).dataset.tid")
        r.click(f'[data-a="cancelar"][data-i="{cancel_id}"]')
        r.shot("bruno-tarefas-pos-cancel")
        r.logout()

        # ---------- Ana agenda e executa ----------
        r.login("ana@teste.com")
        r.shot("ana-agenda-pendentes")
        ids = pg.eval_on_selector_all(".strip [data-tid]", "e => e.map(x => [x.dataset.tid, x.textContent])")
        office = next(i for i, t in ids if "Office" in t)
        limpeza = next(i for i, t in ids if "Limpeza" in t)
        r.click(f'[data-a="aceitar"][data-i="{office}"]')  # sem duração -> aviso
        assert "dura" in pg.inner_text("#toast")
        pg.select_option(f'.dsel[data-i="{office}"]', "30")
        r.wait()
        r.click(f'[data-a="aceitar"][data-i="{office}"]')
        pg.select_option(f'.dsel[data-i="{limpeza}"]', "60")
        r.wait()
        # agendamento por toque: seleciona o cartão e toca num horário livre
        r.click(f'.strip [data-tid="{limpeza}"] b')
        r.click(f'.slot[data-t="{ms(10)}"]')
        r.shot("ana-agenda-agendada")
        r.click(f'[data-d="15"][data-i="{office}"]')
        r.click(f'[data-d="-15"][data-i="{office}"]')
        r.click('[data-prop="1"]')
        r.shot("proposta")
        r.click('[data-no="1"]')
        # executa Office
        r.click(f'[data-a="iniciar"][data-i="{office}"]')
        r.click(f'[data-a="pausar"][data-i="{office}"]')
        r.click(f'[data-a="retomar"][data-i="{office}"]')
        r.click(f'[data-a="iniciar"][data-i="{limpeza}"]')  # bloqueado: já há uma em andamento
        assert "andamento" in pg.inner_text("#toast")
        r.click(f'[data-a="concluir"][data-i="{office}"]')
        pg.fill("#dn_t", "Instalado e ativado.")
        r.click("#dn_ok")
        assert device_status(r, dev_id) == "Inoperante"  # agendada, ainda não iniciada
        # executa Limpeza antes do horário (puxa para agora)
        r.click(f'[data-a="iniciar"][data-i="{limpeza}"]')
        assert device_status(r, dev_id) == "Em manutenção"
        r.click(f'[data-a="pausar"][data-i="{limpeza}"]')
        assert device_status(r, dev_id) == "Em manutenção"  # pausada continua em manutenção
        r.click(f'[data-a="retomar"][data-i="{limpeza}"]')
        r.click(f'[data-h="{limpeza}"]')
        r.shot("ana-agenda-andamento")
        r.click(f'[data-a="concluir"][data-i="{limpeza}"]')
        pg.fill("#dn_t", "Cabeçote limpo.")
        r.click("#dn_ok")
        r.tab("tarefas")
        r.click('[data-tf="hist"]')
        r.shot("ana-historico")
        r.click(f'[data-open="{limpeza}"]')
        r.shot("info-modal", "#mdb")
        r.click("#dn_no")
        r.tab("workstation")
        r.click(f'[data-dev="{dev_id}"]')
        r.shot("dev-log-final", "#mdb")
        log = pg.inner_text("#mdb")
        assert "Fora de uso → Inoperante (tarefa “Manutenção: Limpeza” aberta por Bruno)" in log, log
        assert "Inoperante → Em manutenção (tarefa “Manutenção: Limpeza” iniciada por Ana Souza)" in log, log
        assert "Em manutenção → Operacional (manutenção concluída)" in log, log
        assert device_status(r, dev_id) == "Operacional"
        # Log resumido (5 últimos) e "+log" com o histórico completo.
        preview = [l for l in pg.inner_text("#mdb .history.log").split("\n") if l.strip()]
        assert len(preview) == 5 and preview[0].endswith("Operacional (manutenção concluída)"), preview
        assert "(5 de 7)" in pg.inner_text("#mdb .log-head")
        r.click(f'[data-fulllog="{dev_id}"]')
        assert pg.locator("#mdb .log-row").count() == 7
        assert pg.inner_text("#mdb .log-row >> nth=-1").count("Cadastro") == 1  # mais antigo por último
        r.shot("log-completo", "#mdb")
        r.click(f'#mdb [data-dev="{dev_id}"]')  # voltar ao aparelho
        assert pg.locator("#mdb .dv_st").count() == 1
        r.click("#dn_no")
        # notificações
        r.click("#bell")
        r.shot("ana-notifs", "#pnb")
        r.click("#nclr")
        r.click("#pnx")
        r.shot("ana-topo", "#top")
        # trocar de conta pelo menu
        r.click("#mnb")
        r.click('[data-sw="1"]')
        r.shot("menu-trocar", "#mn_b")
        r.click("#mnx")
        r.logout()

        # ---------- Bruno vê o resultado ----------
        r.login("bruno@teste.com")
        r.click("#bell")
        r.shot("bruno-notifs", "#pnb")
        r.click("#pnx")
        r.tab("tarefas")
        r.click('[data-tf="hist"]')
        r.shot("bruno-historico")

        data = r.db()
        assert len(data["tasks"]) == 3, data["tasks"]
        statuses = sorted(json.loads(t)["status"] for t in data["tasks"])
        assert statuses == ["cancelada", "concluida", "concluida"], statuses
        dev = json.loads(data["devices"][0])
        assert any("Cabeçote limpo" in l["x"] for l in dev["log"]), dev["log"]
        assert len(data["tutorials"]) == 2
        assert not r.errors, r.errors
        if dump:
            pathlib.Path(dump).write_text(json.dumps({"shots": r.shots, "db": data}, ensure_ascii=False, indent=1))

        extra_flows(r)
        assert not r.errors, r.errors
        n = priority_flow(b, shots_dir)
        n += company_flow(b, shots_dir)
        n += open_task_flow(b, shots_dir)
        n += deletion_flow(b, shots_dir)
        n += recurrence_flow(b, shots_dir)
        n += email_confirmation_flow(b, shots_dir)
        n += holiday_flow(b, shots_dir)
        n += absent_flow(b, shots_dir)
        n += after_hours_flow(b, shots_dir)
        n += mobile_strip_flow(b, shots_dir)
        print(f"OK: {len(r.shots) + n} telas verificadas, sem erros de JavaScript.")
        b.close()


# PNG 1×1 válido, usado como ícone de categoria.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")


def priority_flow(browser, shots_dir):
    """Aceite respeita a urgência: a mais urgente entra na frente das menos urgentes já agendadas."""
    ctx = browser.new_context(viewport={"width": 420, "height": 900}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "prioridade" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    r.signup("Gestor", "gestor@teste.com")
    r.create_company("Oficina Prioridade")
    func_link, sol_link = r.invite("func"), r.invite("sol")
    r.logout()
    pg.goto(func_link)
    r.signup("Carla", "carla@teste.com")
    carla_id = pg.evaluate("state.uid")
    r.logout()
    pg.goto(sol_link)
    r.signup("Davi", "davi@teste.com")
    for title, prio in [("Em curso", "neutra"), ("Baixa 1", "baixa"), ("Neutra 1", "neutra"), ("Urgente", "alta")]:
        r.click("#nfab")
        pg.fill("#f_t", title)
        pg.fill("#f_d", "Teste de prioridade")
        pg.check(f'.f_e[value="{carla_id}"]')
        pg.select_option("#f_p", prio)
        r.click("#f_go")
    r.logout()
    r.login("carla@teste.com")

    def task(title):
        db = json.loads(pg.evaluate("localStorage.getItem('tm_db_v1')"))
        return next(v for k, v in db.items() if k.startswith("tasks/") and v["title"] == title)

    def accept(title, minutes):
        tid = task(title)["id"]
        assert pg.inner_text(f'.strip [data-a="aceitar"][data-i="{tid}"]') == "Aceitar"
        pg.select_option(f'.dsel[data-i="{tid}"]', str(minutes))
        r.wait()
        r.click(f'.strip [data-a="aceitar"][data-i="{tid}"]')
        return tid

    starts = lambda *ts: [task(t)["start"] for t in ts]
    running = accept("Em curso", 30)
    r.click(f'[data-a="iniciar"][data-i="{running}"]')
    assert task("Em curso")["status"] == "andamento"
    accept("Baixa 1", 30)
    assert starts("Baixa 1") == [ms(9, 30)]
    accept("Neutra 1", 60)                     # neutra passa na frente da baixa
    assert starts("Neutra 1", "Baixa 1") == [ms(9, 30), ms(10, 30)], starts("Neutra 1", "Baixa 1")
    accept("Urgente", 30)                      # alta passa na frente de todas, sem mexer na em andamento
    assert starts("Em curso", "Urgente", "Neutra 1", "Baixa 1") == [ms(9), ms(9, 30), ms(10), ms(11)], \
        starts("Em curso", "Urgente", "Neutra 1", "Baixa 1")
    assert any("Reorganizada por prioridade" in h["x"] for h in task("Baixa 1")["hist"])
    r.shot("agenda-por-prioridade")
    # Cartão em andamento: borda da prioridade e previsão de término que acompanha o +15 min.
    assert pg.locator(".card.running").count() >= 1
    assert pg.locator(".card.running").first.get_attribute("data-tid") == running
    header = lambda: pg.inner_text(f'.card.running[data-tid="{running}"] .task-time')
    assert "09:30" in header(), header()
    r.click(f'[data-d="15"][data-i="{running}"]')
    assert "09:45" in header() and "45 min" in header(), header()
    # A urgente que colidiu volta logo depois, ainda na frente das menos urgentes.
    assert starts("Urgente", "Neutra 1", "Baixa 1") == [ms(9, 45), ms(10, 15), ms(11, 15)], \
        starts("Urgente", "Neutra 1", "Baixa 1")
    assert pg.locator('.strip .task-time:has-text("Horário a definir")').count() == 0  # nada pendente
    # Painel detalhado da tarefa em andamento (no celular, no topo; no computador, fixo à direita).
    detail = f'.agenda-side .running-detail[data-tid="{running}"]'
    assert pg.locator(detail).count() == 1
    text = pg.inner_text(detail)
    for part in ("Em execução há", "Faltam 45 min", "Solicitante", "Davi", "Duração prevista", "Histórico"):
        assert part in text, (part, text)
    pg.set_viewport_size({"width": 1280, "height": 900})
    r.wait()
    main_box = pg.locator(".agenda-main").bounding_box()
    side_box = pg.locator(".agenda-side").bounding_box()
    assert side_box["x"] > main_box["x"] + main_box["width"] - 1, (main_box, side_box)  # lado a lado
    pg.mouse.wheel(0, 900)
    r.wait(200)
    assert pg.locator(".agenda-side").bounding_box()["y"] >= 90  # continua fixo ao rolar
    r.shot("desktop-em-andamento", full_page=False)
    # Clicar no cartão fixo leva até a tarefa na agenda e a destaca.
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    r.wait(200)
    target = f'.agenda-main [data-tid="{running}"]'
    assert pg.evaluate(f"document.querySelector('{target}').getBoundingClientRect().top") < 0  # fora da tela
    pg.click(".agenda-side .running-detail .detail-title")
    r.wait(900)
    top = pg.evaluate(f"document.querySelector('{target}').getBoundingClientRect().top")
    assert 90 <= top <= 900, top
    assert "flash" in pg.get_attribute(target, "class")
    pg.set_viewport_size({"width": 420, "height": 900})
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def company_flow(browser, shots_dir):
    """Empresa: pedido de entrada e aprovação, funções x categorias, papéis, remoção e isolamento."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "empresa" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    profile = lambda email: next(v for k, v in json.loads(pg.evaluate("localStorage.getItem('tm_db_v1')")).items()
                                 if k.startswith("profiles/") and v.get("email") == email)

    # Administrador cria a empresa e cadastra os aparelhos na etapa "Aparelhos da empresa".
    r.signup("Gil", "gil@teste.com")
    pg.fill("#ob_cn", "Alfa")
    r.click("#ob_create")
    assert "CEP" in toast(r), toast(r)  # endereço obrigatório
    r.fill_address()
    r.click("#ob_create")
    pg.wait_for_selector("#cs_done")
    assert pg.locator("nav button").count() == 0          # abas só depois da configuração
    r.click("#cs_done")
    assert "Cadastre ao menos um aparelho" in toast(r), toast(r)
    for area, name, ip in [("Impressora", "Impressora Alfa", "10.0.0.1"), ("Computador", "PC Alfa", "10.0.0.2"),
                           ("Computador", "Sobra", "10.0.0.3")]:
        pg.select_option("#dv_a", area)
        pg.fill("#dv_n", name)
        pg.fill("#dv_i", ip)
        r.click("#dv_add")
        assert pg.input_value("#dv_n") == ""                 # formulário volta limpo
    pg.fill("#dv_n", "IP ruim")
    pg.fill("#dv_i", "999.1.1.1")
    r.click("#dv_add")
    assert "IP v" in toast(r)
    sobra = pg.evaluate("Object.values(state.devices).find(d => d.name === 'Sobra').id")
    r.click(f'[data-csdel="{sobra}"]')
    assert pg.locator(".setup-list .list-row").count() == 2
    r.shot("empresa-aparelhos")
    r.click("#cs_done")
    pg.wait_for_selector("nav button")
    assert pg.evaluate("ui.tab") == "workstation" and pg.locator(".device-card").count() == 2
    alfa = pg.evaluate("state.company.id")
    r.tab("empresa")
    pg.fill("#adm_cg_n", "Desenvolvedor")
    r.click("#adm_cg_add")
    pg.check('.cg-cat[data-cargo="desenvolvedor"][data-cgcat="Computador"]')
    r.wait(200)
    cargos = pg.evaluate("state.company.cargos")
    assert cargos["desenvolvedor"]["cats"] == ["Computador"], cargos
    r.logout()

    # Hugo pede para entrar como solicitante e fica aguardando.
    r.signup("Hugo", "hugo@teste.com")
    pg.select_option("#ob_company", alfa)
    pg.select_option("#ob_role", "sol")
    r.click("#ob_join")
    pg.wait_for_selector("#ob_cancel")
    assert pg.locator("nav button").count() == 0 and "Alfa" in pg.inner_text("#app")
    assert pg.evaluate("Object.keys(state.devices).length") == 0  # pendente não vê nada da empresa
    r.shot("aguardando-aprovacao")
    r.logout()

    # O administrador vê o pedido (com contador) e aceita como funcionário/Desenvolvedor.
    r.login("gil@teste.com")
    assert "1" in pg.inner_text('nav [data-tab="empresa"]')
    r.tab("empresa")
    hugo = pg.get_attribute("[data-accept]", "data-accept")
    pg.select_option(f'.jr-role[data-id="{hugo}"]', "func")
    pg.select_option(f'.jr-cargo[data-id="{hugo}"]', "desenvolvedor")
    r.click(f'[data-accept="{hugo}"]')
    r.shot("membro-aceito")
    h = profile("hugo@teste.com")
    assert (h["status"], h["role"], h["ws"]["cargo"]) == ("active", "func", "desenvolvedor"), h
    r.logout()

    # Hugo (Desenvolvedor) só enxerga os computadores.
    r.login("hugo@teste.com")
    assert r.tabs() == ["Agenda", "Tarefas", "Área de Trabalho"], r.tabs()
    r.tab("workstation")
    names = pg.eval_on_selector_all(".device-card .device-name", "e => e.map(x => x.textContent)")
    assert names == ["PC Alfa"], names
    r.logout()

    # O administrador muda o papel de Hugo para solicitante e depois o remove da empresa.
    r.login("gil@teste.com")
    r.tab("empresa")
    pg.select_option(f'.m-role[data-id="{hugo}"]', "sol")
    r.wait(200)
    assert profile("hugo@teste.com")["role"] == "sol"
    r.click(f'[data-mremove="{hugo}"]')
    assert profile("hugo@teste.com")["company"] is None
    r.logout()

    # Nome de usuário: repetido é recusado (sem diferença de maiúsculas); login pelo nome funciona.
    pg.wait_for_selector("#a_go")
    if not pg.query_selector("#a_n"):
        r.click("#a_mode")
    pg.fill("#a_n", "Outro Gil")
    pg.fill("#a_u", "GIL")
    pg.fill("#a_e", "outro.gil@teste.com")
    pg.fill("#a_p", "123456")
    r.click("#a_go")
    assert pg.inner_text("#a_m") == "Este nome de usuário já está em uso.", pg.inner_text("#a_m")
    pg.fill("#a_u", "gil@x")
    r.click("#a_go")
    assert "Nome de usuário:" in pg.inner_text("#a_m"), pg.inner_text("#a_m")
    r.click("#a_mode")
    pg.fill("#a_e", "gil")
    pg.fill("#a_p", "errada")
    r.click("#a_go")
    r.wait(300)
    assert "incorretos" in pg.inner_text("#a_m"), pg.inner_text("#a_m")
    r.login("gil")  # entra pelo nome de usuário
    assert pg.evaluate("state.me.email") == "gil@teste.com"
    # Troca do nome de usuário nas configurações: repetido é recusado, livre é salvo.
    r.menu("perfil")
    pg.fill("#p_u", "hugo")
    r.click("#p_go")
    r.wait(200)
    assert toast(r) == "Este nome de usuário já está em uso.", toast(r)
    pg.fill("#p_u", "Gil.Admin")
    r.click("#p_go")
    r.wait(200)
    assert profile("gil@teste.com")["username"] == "gil.admin"
    r.logout()
    r.login("gil.admin")
    r.logout()

    # Outra empresa não enxerga nada da Alfa.
    r.signup("Isa", "isa@teste.com")
    r.create_company("Beta")
    seen = pg.evaluate("({ dev: Object.keys(state.devices).length, people: Object.keys(state.profiles).length })")
    assert seen == {"dev": 0, "people": 1}, seen
    r.tab("equipe")
    assert "Gil" not in pg.inner_text("#app")
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def open_task_flow(browser, shots_dir):
    """Tarefa sem responsável: aparece para quem atende a categoria (e o admin); o primeiro que aceitar fica."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "aberta" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    task = lambda title: next(v for k, v in json.loads(pg.evaluate("localStorage.getItem('tm_db_v1')")).items()
                              if k.startswith("tasks/") and v["title"] == title)

    # Admin cria a empresa, uma impressora, a função Desenvolvedor (só Computador) e os convites.
    r.signup("Lia", "lia@teste.com")
    r.create_company("Oficina Aberta")
    r.tab("workstation")
    r.click('[data-wst="new"]')
    pg.select_option("#dv_a", "Impressora")
    pg.fill("#dv_n", "Impressora Sala 2")
    pg.fill("#dv_i", "10.0.0.20")
    r.click("#dv_add")
    dev = pg.get_attribute(".device-card", "data-did")
    r.tab("empresa")
    pg.fill("#adm_cg_n", "Desenvolvedor")
    r.click("#adm_cg_add")
    pg.check('.cg-cat[data-cargo="desenvolvedor"][data-cgcat="Computador"]')
    r.wait(200)
    func_link, sol_link = r.invite("func"), r.invite("sol")
    r.logout()
    for name, email, cargo in [("Téo TI", "teo@teste.com", "ti"), ("Dani Dev", "dani@teste.com", "desenvolvedor")]:
        pg.goto(func_link)
        r.signup(name, email)
        r.tab("workstation")
        pg.select_option("#w_c", cargo)
        r.click("#w_save")
        r.logout()

    # Solicitante abre manutenção na impressora sem escolher ninguém → tarefa aberta (categoria Impressora).
    pg.goto(sol_link)
    r.signup("Sol", "sol@teste.com")
    r.click("#nfab")
    pg.select_option("#f_v", dev)
    r.wait()
    assert pg.locator(".f_e:checked").count() == 0
    r.click('[data-pk="Limpeza"]')
    r.click("#f_go")
    t = task("Manutenção: Limpeza")
    assert t["pool"] is True and t["emp"] is None and t["cat"] == "Impressora", t
    # E uma tarefa geral (sem aparelho, tipo Geral) também aberta.
    r.click("#nfab")
    pg.fill("#f_t", "Organizar cabos")
    pg.fill("#f_d", "Sala de reunião")
    r.click("#f_go")
    assert task("Organizar cabos")["cat"] is None
    r.tab("tarefas")
    assert "aberta para a equipe" in pg.inner_text("#app")
    r.logout()

    # Dev não recebe a da impressora, mas recebe a geral; não consegue assumir a da impressora nem forçando.
    r.login("dani")
    titles = pg.eval_on_selector_all(".strip .open-task b", "e => e.map(x => x.textContent)")
    assert titles == ["Organizar cabos"], titles
    forced = pg.evaluate(f"""async () => {{ try {{ await state.db.call('claim_task', {{ task_id: '{t["id"]}' }}); return 'ok'; }}
                                          catch (e) {{ return e.message; }} }}""")
    assert forced == "Esta tarefa não é da sua função.", forced
    r.logout()

    # Admin vê as duas.
    r.login("lia")
    titles = sorted(pg.eval_on_selector_all(".strip .open-task b", "e => e.map(x => x.textContent)"))
    assert titles == ["Manutenção: Limpeza", "Organizar cabos"], titles
    r.logout()

    # TI vê as duas, aceita a da impressora (precisa de duração) e ela some das abertas.
    r.login("teo")
    teo = pg.evaluate("state.uid")
    tid = t["id"]
    r.click(f'[data-claim="{tid}"]')
    assert toast(r) == "Defina a duração antes.", toast(r)
    pg.select_option(f'.psel[data-i="{tid}"]', "30")
    r.click(f'[data-claim="{tid}"]')
    r.wait(300)
    t = task("Manutenção: Limpeza")
    assert t["emp"] == teo and t["dur"] == 30 and t["status"] == "agendada", t
    assert any("Assumida por Téo TI" in h["x"] for h in t["hist"]), t["hist"]
    assert pg.locator(f'.open-task[data-tid="{tid}"]').count() == 0
    r.shot("aberta-assumida")
    r.logout()

    # Depois de assumida, ninguém mais pega (nem o admin).
    r.login("lia")
    assert pg.locator(f'.open-task[data-tid="{tid}"]').count() == 0
    forced = pg.evaluate(f"""async () => {{ try {{ await state.db.call('claim_task', {{ task_id: '{tid}' }}); return 'ok'; }}
                                          catch (e) {{ return e.message; }} }}""")
    assert forced == "Outro funcionário já pegou esta tarefa.", forced
    # Admin: sem "Configurações de trabalho" no menu (faz tudo na aba Empresa); exclui aparelho pela janela dele.
    r.click("#mnb")
    assert pg.locator('#mn_b [data-go="wcfg"]').count() == 0
    r.click("#mnx")
    r.tab("workstation")
    r.click(f'[data-dev="{dev}"]')
    r.click(f'[data-devdel="{dev}"]')
    assert pg.locator(f'.device-card[data-did="{dev}"]').count() == 0
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def deletion_flow(browser, shots_dir):
    """Excluir conta (com confirmação e senha) e excluir empresa (só o admin, apaga tudo dela)."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "exclusao" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    db = lambda: json.loads(pg.evaluate("localStorage.getItem('tm_db_v1')"))
    rows = lambda col: [v for k, v in db().items() if k.startswith(col + "/")]

    r.signup("Zé", "ze@teste.com")
    r.create_company("Zeta")
    r.tab("workstation")
    r.click('[data-wst="new"]')
    pg.select_option("#dv_a", "Computador")
    pg.fill("#dv_n", "PC Zeta")
    pg.fill("#dv_i", "10.0.0.30")
    r.click("#dv_add")
    func_link, sol_link = r.invite("func"), r.invite("sol")
    r.logout()
    pg.goto(func_link)
    r.signup("Rui", "rui@teste.com")
    rui = pg.evaluate("state.uid")
    r.logout()
    pg.goto(sol_link)
    r.signup("Mia", "mia@teste.com")
    r.click("#nfab")
    pg.fill("#f_t", "Trocar teclado")
    pg.fill("#f_d", "Tecla quebrada")
    pg.check(f'.f_e[value="{rui}"]')
    r.click("#f_go")
    r.logout()

    # Rui exclui a conta: confirmação e senha são exigidas.
    r.login("rui")
    r.menu("perfil")
    r.click("#xa_open")
    pg.fill("#xa_p", "123456")
    pg.fill("#xa_t", "sim")
    r.click("#xa_ok")
    assert toast(r) == "Digite EXCLUIR para confirmar.", toast(r)
    pg.fill("#xa_p", "errada")
    pg.fill("#xa_t", "excluir")
    r.click("#xa_ok")
    r.wait(300)
    assert toast(r) == "Senha atual incorreta.", toast(r)
    pg.fill("#xa_p", "123456")
    r.click("#xa_ok")
    pg.wait_for_selector("#a_go")
    assert not any(p.get("email") == "rui@teste.com" for p in rows("profiles"))
    t = next(t for t in rows("tasks") if t["title"] == "Trocar teclado")
    assert t["emp"] is None and t["pool"] is True and t["status"] == "aguardando", t  # volta para a equipe
    pg.fill("#a_e", "rui")
    pg.fill("#a_p", "123456")
    r.click("#a_go")
    r.wait(300)
    assert "incorretos" in pg.inner_text("#a_m")  # a conta não existe mais

    # O admin não exclui a conta enquanto tiver empresa; exclui a empresa (nome tem de conferir).
    r.login("ze")
    r.menu("perfil")
    assert pg.locator("#xa_open").count() == 0 and "exclua a empresa antes" in pg.inner_text(".danger-zone")
    r.tab("empresa")
    r.click("#xc_open")
    pg.fill("#xc_t", "Zet")
    pg.fill("#xc_p", "123456")
    r.click("#xc_ok")
    assert toast(r) == "O nome digitado não confere.", toast(r)
    pg.fill("#xc_t", "Zeta")
    r.click("#xc_ok")
    pg.wait_for_selector("#ob_cn")  # admin volta para a tela de entrada
    assert rows("companies") == [] and rows("tasks") == [] and rows("devices") == [] and rows("invites") == []
    mia = next(p for p in rows("profiles") if p.get("email") == "mia@teste.com")
    assert mia["company"] is None and mia["status"] is None, mia
    # Sem empresa, agora o admin pode excluir a própria conta.
    r.menu("perfil")
    r.click("#xa_open")
    pg.fill("#xa_p", "123456")
    pg.fill("#xa_t", "EXCLUIR")
    r.click("#xa_ok")
    pg.wait_for_selector("#a_go")
    assert not any(p.get("email") == "ze@teste.com" for p in rows("profiles"))
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def recurrence_flow(browser, shots_dir):
    """Manutenção periódica: prioridade alta, não deixa o aparelho inoperante e se repete ao concluir."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "periodica" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    tasks = lambda: [v for k, v in json.loads(pg.evaluate("localStorage.getItem('tm_db_v1')")).items() if k.startswith("tasks/")]

    r.signup("Rui", "rui@teste.com")
    r.create_company("Gráfica Periódica", [("Impressora", "Impressora Balcão", "10.0.0.5")])
    me = pg.evaluate("state.uid")
    dev = pg.evaluate("Object.keys(state.devices)[0]")

    def create(n, unit, problem):
        r.click("#nfab")
        pg.select_option("#f_v", dev)
        r.wait()
        pg.check("#f_rc")
        r.wait()
        assert pg.eval_on_selector("#f_p", "e => e.disabled && e.value") == "alta"
        pg.fill("#f_rn", str(n))
        pg.select_option("#f_ru", unit)
        pg.check(f'.f_e[value="{me}"]')
        r.click(f'[data-pk="{problem}"]')
        r.click("#f_go")
        return next(t for t in tasks() if t.get("preset") == problem and t["status"] == "aguardando")

    def run_and_finish(t, summary):
        r.tab("tarefas")
        pg.select_option(f'.dsel[data-i="{t["id"]}"]', "30")
        r.wait(200)
        r.click(f'[data-a="aceitar"][data-i="{t["id"]}"]')
        r.tab("agenda")
        r.click(f'[data-a="iniciar"][data-i="{t["id"]}"]')
        assert device_status(r, dev) == "Em manutenção"
        r.click(f'[data-a="concluir"][data-i="{t["id"]}"]')
        pg.fill("#dn_t", summary)
        r.click("#dn_ok")
        r.wait(300)

    # A cada 3 meses: criada com prioridade alta e o aparelho continua Operacional até iniciar.
    t = create(3, "m", "Limpeza")
    assert t["prio"] == "alta" and t["rec"] == {"n": 3, "u": "m"}, t
    assert device_status(r, dev) == "Operacional"
    run_and_finish(t, "Limpeza feita")
    assert device_status(r, dev) == "Operacional"
    nxt = next(x for x in tasks() if x.get("series") == t["id"])
    due = int(datetime(2027, 2, 11, tzinfo=TZ).timestamp() * 1000)
    assert nxt["status"] == "programada" and nxt["want"] == due, nxt
    assert nxt["prio"] == "alta" and nxt["dur"] == 30 and nxt["emp"] == me and nxt["dev"] == dev, nxt
    log = pg.evaluate(f"JSON.parse(localStorage.getItem('tm_db_v1'))['devices/{dev}'].log.map(l => l.x)")
    assert any("próxima em 11/02/2027" in x for x in log), log
    r.tab("tarefas")
    txt = r.shot("periodica-programada")
    assert "próxima manutenção" in txt.lower() and "11/02/2027" in txt and "a cada 3 meses" in txt, txt

    # A cada 1 dia: a próxima cai nesta semana, então já entra na agenda (amanhã).
    t2 = create(1, "d", "Esvaziar Impressora")
    run_and_finish(t2, "Esvaziada")
    nxt2 = next(x for x in tasks() if x.get("series") == t2["id"])
    assert nxt2["status"] == "agendada" and ms(0, 0, 12) <= nxt2["start"] < ms(0, 0, 13), nxt2
    assert device_status(r, dev) == "Operacional"

    # Problema pré-definido editável: renomear e deixar o aviso periódico já marcado na Nova tarefa.
    r.tab("empresa")
    r.click('[data-cat="Impressora"]')
    idx = pg.evaluate("problemsOf('Impressora').indexOf('Esvaziar Impressora')")
    r.click(f'[data-pedit="{idx}"]')
    pg.fill("#pb_en", "Esvaziamento da impressora")
    pg.check("#pb_rc")
    pg.fill("#pb_rn", "2")
    pg.select_option("#pb_ru", "m")
    r.click("#pb_save")
    assert "aviso a cada 2 meses" in pg.inner_text("#mdb"), pg.inner_text("#mdb")
    assert pg.evaluate("problemsOf('Impressora')[%d]" % idx) == "Esvaziamento da impressora"
    r.click("#dn_no")
    r.click("#nfab")
    pg.select_option("#f_v", dev)
    r.wait()
    r.click('[data-pk="Esvaziamento da impressora"]')
    assert pg.is_checked("#f_rc") and pg.input_value("#f_rn") == "2" and pg.input_value("#f_ru") == "m"
    assert pg.eval_on_selector("#f_p", "e => e.disabled && e.value") == "alta"
    r.click('[data-pk="Esvaziamento da impressora"]')  # desmarcar o problema desfaz o aviso automático
    assert not pg.is_checked("#f_rc")
    r.click("#dn_no")

    # Cancelar a programada encerra a repetição.
    r.tab("tarefas")
    r.click(f'[data-a="cancelar"][data-i="{nxt["id"]}"]')
    assert next(x for x in tasks() if x["id"] == nxt["id"])["status"] == "cancelada"

    # Alerta na Área de Trabalho: aparelho novo, problema periódico (a cada 2 meses) nunca feito e nada marcado.
    card = f'.device-card[data-did="{dev}"]'
    r.tab("workstation")
    assert pg.locator(card + " .device-alert").count() == 0  # cadastrado hoje: ainda longe do fim
    created = ms(9, 0, 11) - 40 * 86400000  # cadastrado há 40 dias → vence em ~21 dias (falta menos de 1 mês)
    pg.evaluate(f"""() => {{ const db = JSON.parse(localStorage.getItem('tm_db_v1'));
                             db['devices/{dev}'].created = {created}; localStorage.setItem('tm_db_v1', JSON.stringify(db)); }}""")
    pg.reload()
    pg.wait_for_selector("nav button")
    r.tab("workstation")
    alert = pg.inner_text(card + " .device-alert")
    assert "Esvaziamento da impressora" in alert and "vence em" in alert, alert
    assert pg.locator(card + " .alert-ping").count() == 1
    r.shot("periodica-alerta")
    # Marcada uma tarefa desse problema, o alerta some.
    r.click("#nfab")
    pg.select_option("#f_v", dev)
    r.wait()
    r.click('[data-pk="Esvaziamento da impressora"]')
    pg.check(f'.f_e[value="{me}"]')
    r.click("#f_go")
    r.tab("workstation")
    assert pg.locator(card + " .device-alert").count() == 0

    # Agenda por dia, semana e mês; ir para uma data em 2 cliques (campo de data → dia).
    r.tab("agenda")
    r.click('[data-av="semana"]')
    assert pg.locator(".week-day").count() == 7
    assert "Esvaziada" not in pg.inner_text(".week-grid")  # títulos, não relatos
    week_txt = pg.inner_text(".week-grid")
    assert "Esvaziar Impressora" in week_txt, week_txt  # a de amanhã (12/11)
    r.shot("agenda-semana")
    r.click('[data-av="mes"]')
    assert pg.locator(".month-day").count() == 30 and "Novembro de 2026" in pg.inner_text(".agenda-label")
    r.click('[data-day="1"]')
    assert "Dezembro de 2026" in pg.inner_text(".agenda-label")
    pg.fill("#ag_d", "2027-02-11")
    r.wait()
    assert "Fevereiro de 2027" in pg.inner_text(".agenda-label")
    pg.set_viewport_size({"width": 1280, "height": 900})
    r.click('[data-agtoday="1"]')
    r.click('[data-av="mes"]')
    r.click('[data-agday="%d"]' % ms(0, 0, 11))
    r.shot("agenda-mes-dia")  # tocar no dia abre a visão Dia
    assert pg.locator('[data-av="dia"].primary').count() == 1
    assert "11/11/2026" in pg.inner_text(".agenda-label")
    r.click('[data-av="mes"]')
    r.shot("agenda-mes-desktop")
    r.click('[data-av="semana"]')
    r.shot("agenda-semana-desktop")
    r.click('[data-av="dia"]')
    pg.fill("#ag_d", "2026-11-20")
    r.wait()
    assert "fora da semana atual" in pg.inner_text("#app") and pg.locator(".slot[data-t]").count() == 0
    r.click('[data-agtoday="1"]')
    assert pg.locator(".slot[data-t]").count() > 0  # hoje: horários livres clicáveis
    pg.set_viewport_size({"width": 420, "height": 1400})
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def holiday_flow(browser, shots_dir):
    """Endereço pelo CEP e feriados da cidade na agenda (oficiais sem expediente; facultativo só aviso)."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "feriados" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    r.signup("Bia", "bia@teste.com")
    pg.fill("#ob_cn", "Carioca Ltda")
    pg.fill("#ob_cep", "99999999")
    pg.wait_for_function("document.querySelector('#ob_cepm').textContent.includes('não encontrado')")
    pg.fill("#ob_cep", "20040002")
    pg.wait_for_function("document.querySelector('#ob_cid').value === 'Rio de Janeiro'")
    assert pg.input_value("#ob_rua") == "Rua da Assembleia" and pg.input_value("#ob_bai") == "Centro"
    assert pg.input_value("#ob_uf") == "RJ" and pg.input_value("#ob_num") == ""  # número não é preenchido
    assert pg.input_value("#ob_cep") == "20040-002"
    pg.fill("#ob_num", "10")
    r.shot("empresa-endereco")
    r.click("#ob_create")
    pg.wait_for_selector("#cs_done")
    pg.check("#cs_skip")
    r.click("#cs_done")
    pg.wait_for_function("!!state.company.holidays?.years?.[2027]")
    addr = pg.evaluate("state.company.addr")
    assert addr == {"cep": "20040-002", "rua": "Rua da Assembleia", "num": "10", "comp": "", "bairro": "Centro",
                    "cidade": "Rio de Janeiro", "uf": "RJ", "ibge": "3304557"}, addr
    hol = pg.evaluate("state.company.holidays.years")
    days = {h["d"]: h for h in hol["2026"]}
    assert days["2026-11-12"] == {"d": "2026-11-12", "n": "Feriado de Teste", "t": "M"}, days
    assert days["2026-04-23"]["t"] == "E" and "2026-07-09" not in days and "2026-01-25" not in days  # só RJ/Rio
    assert days["2026-11-13"]["t"] == "F" and "2026-12-14" not in days  # facultativo de outra cidade fica de fora
    # 2027 ainda sem dados: nacionais pela BrasilAPI (Carnaval = facultativo) + previstos do ano anterior.
    d27 = {h["d"]: h for h in hol["2027"]}
    assert d27["2027-01-01"]["t"] == "N" and d27["2027-02-09"]["t"] == "F", d27
    assert d27["2027-05-27"] == {"d": "2027-05-27", "n": "Corpus Christi", "t": "M", "est": 1}, d27  # Páscoa 2027 + 60
    assert d27["2027-11-12"]["est"] == 1

    # Agenda: feriado oficial vira dia sem expediente; o facultativo só avisa.
    assert pg.evaluate("isHolidayOff(%d) && !isHolidayOff(%d)" % (ms(9, 0, 12), ms(9, 0, 13)))
    assert pg.evaluate("findSlot(profileOf(state.uid), [], 30, %d)" % ms(8, 0, 12)) == ms(8, 0, 13)
    assert pg.evaluate("fitsAt({ emp: state.uid, dur: 30, id: 'x' }, %d)" % ms(9, 0, 12)) is False
    r.tab("agenda")
    r.click('[data-av="semana"]')
    week = r.shot("feriado-semana")
    assert "Feriado municipal: Feriado de Teste" in week and "Ponto facultativo: Dia do Ponto Facultativo" in week, week
    r.click('[data-agday="%d"]' % ms(0, 0, 12))
    assert "Dia sem expediente" in pg.inner_text(".agenda-main") and pg.locator(".slot[data-t]").count() == 0
    r.click('[data-day="1"]')
    assert "dia normal de trabalho" in pg.inner_text(".agenda-main")
    pg.set_viewport_size({"width": 1280, "height": 900})
    r.click('[data-av="mes"]')
    r.shot("feriado-mes-desktop")
    pg.set_viewport_size({"width": 420, "height": 1400})

    # Tarefa que estava agendada num dia que virou feriado é reagendada.
    r.click("#nfab")
    pg.fill("#f_t", "Conferir rede")
    pg.fill("#f_d", "Teste")
    pg.check(f'.f_e[value="{pg.evaluate("state.uid")}"]')
    r.click("#f_go")
    tid = pg.evaluate("allTasks().find(t => t.title === 'Conferir rede').id")
    pg.evaluate(f"(async () => {{ await commitTask('{tid}', {{ dur: 30, status: 'agendada', start: {ms(9, 0, 12)} }}, 'teste'); await requeueHolidayTasks(); }})()")
    r.wait(300)
    t = pg.evaluate(f"state.tasks['{tid}']")
    assert t["status"] == "agendada" and not pg.evaluate(f"isHolidayOff({t['start']})"), t
    assert any("Feriado municipal: Feriado de Teste" in h["x"] for h in t["hist"]), t["hist"]

    # Aba Empresa: endereço editável e próximos feriados.
    r.tab("empresa")
    txt = r.shot("empresa-feriados")
    assert "Feriados de Rio de Janeiro/RJ" in txt and "Feriado de Teste" in txt, txt
    r.fill_address("adm", "01001000", "5")
    r.click("#adm_addr")
    pg.wait_for_function("state.company.holidays.ibge === '3550308'")
    assert pg.evaluate("isHolidayOff(%d)" % ms(9, 0, 12)) is False  # em São Paulo, 12/11 é dia normal
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def absent_flow(browser, shots_dir):
    """"Marcar hoje como ausente": confirmação, folga só de hoje e tarefas de hoje no dia seguinte (pela urgência)."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "ausente" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    r.signup("Edu", "edu@teste.com")
    r.create_company("Ausência Ltda")
    me = pg.evaluate("state.uid")

    def new_task(title, prio):
        r.click("#nfab")
        pg.fill("#f_t", title)
        pg.fill("#f_d", "Teste")
        pg.select_option("#f_p", prio)
        pg.check(f'.f_e[value="{me}"]')
        r.click("#f_go")
        tid = pg.evaluate(f"allTasks().find(t => t.title === '{title}').id")
        r.tab("tarefas")
        pg.select_option(f'.dsel[data-i="{tid}"]', "60")
        r.wait(200)
        r.click(f'[data-a="aceitar"][data-i="{tid}"]')
        return tid

    low = new_task("Organizar arquivo", "baixa")
    high = new_task("Servidor fora do ar", "alta")
    task = lambda tid: pg.evaluate(f"state.tasks['{tid}']")
    assert all(ms(0, 0, 11) <= task(t)["start"] < ms(0, 0, 12) for t in (low, high))  # as duas hoje

    r.menu("folgas")
    assert "Marcar hoje como ausente" in pg.inner_text("#app") and "2 tarefas agendadas" in pg.inner_text("#app")
    r.click("#ab_open")
    modal = r.shot("ausente-confirmar", "#mdb")
    assert "Marcar hoje como ausente?" in modal and "Servidor fora do ar" in modal and "Organizar arquivo" in modal, modal
    r.click("#dn_no")  # cancelar não muda nada
    assert not pg.evaluate("isAbsentOn(profileOf(state.uid), %d)" % ms(0, 0, 11))
    r.click("#ab_open")
    r.click("#ab_ok")
    r.wait(400)
    assert "2 tarefas reagendadas" in toast(r), toast(r)
    off = pg.evaluate("state.me.off")
    assert off == [{"s": ms(0, 0, 11), "e": ms(0, 0, 12), "note": "Ausente"}], off  # só o dia de hoje
    h, l = task(high), task(low)
    assert h["status"] == l["status"] == "agendada", (h, l)
    assert h["start"] == ms(8, 0, 12) and l["start"] == ms(9, 0, 12), (h["start"], l["start"])  # amanhã, urgente primeiro
    assert any("ausente em 11/11/2026" in x["x"] for x in h["hist"]), h["hist"]
    txt = r.shot("ausente-marcado")
    assert "Você está marcado como ausente hoje" in txt, txt
    r.tab("agenda")
    assert "Indisponível: Ausente" in pg.inner_text(".agenda-main")
    assert pg.locator(".slot[data-t]").count() == 0  # hoje não aceita mais tarefas
    r.tab("equipe")
    assert "De folga (Ausente)" in pg.inner_text("#app")
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def after_hours_flow(browser, shots_dir):
    """Depois do expediente: aceitar agenda para o dia seguinte; iniciar hoje só com confirmação; toque duplo ignorado."""
    ctx = browser.new_context(viewport={"width": 420, "height": 1400}, timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(datetime(2026, 11, 11, 17, 30, tzinfo=TZ))  # expediente 08:00–17:00 já acabou
    r = Run(pg, shots_dir / "expediente" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    r.signup("Iva", "iva@teste.com")
    r.create_company("Noturna Ltda")
    me = pg.evaluate("state.uid")
    r.click("#nfab")
    pg.fill("#f_t", "Urgente da noite")
    pg.fill("#f_d", "Teste")
    pg.select_option("#f_p", "alta")
    pg.check(f'.f_e[value="{me}"]')
    r.click("#f_go")
    tid = pg.evaluate("allTasks().find(t => t.title === 'Urgente da noite').id")
    r.tab("tarefas")
    pg.select_option(f'.dsel[data-i="{tid}"]', "60")
    r.wait(200)
    task = lambda: pg.evaluate(f"state.tasks['{tid}']")
    # Toque duplo: o segundo toque cai no "Iniciar" que aparece no lugar — deve ser ignorado.
    btn = f'[data-a="aceitar"][data-i="{tid}"]'
    box = pg.locator(btn).bounding_box()
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    r.wait(150)
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    r.wait(300)
    t = task()
    assert t["status"] == "agendada" and t["start"] == ms(8, 0, 12) and t["dur"] == 60, t  # dia seguinte; 2º toque ignorado
    assert pg.locator("#md.open").count() == 0
    # Iniciar agora (fora do expediente) pede confirmação; cancelar mantém amanhã.
    r.wait(800)
    r.click(f'[data-a="iniciar"][data-i="{tid}"]')
    txt = r.shot("iniciar-fora-expediente", "#mdb")
    assert "Iniciar fora do expediente?" in txt and "08:00–17:00" in txt, txt
    r.click("#dn_no")
    assert task()["start"] == ms(8, 0, 12)
    r.click(f'[data-a="iniciar"][data-i="{tid}"]')
    r.click("#so_ok")
    r.wait(300)
    t = task()
    assert t["status"] == "andamento" and t["start"] == ms(17, 30, 11), t  # só assim entra hoje, fora do horário
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def mobile_strip_flow(browser, shots_dir):
    """"Tarefas para agendar": lista vertical no celular (3 + "Ver todas"), contador na aba Tarefas,
    arrastar pela alça ⠿ com o dedo, e faixa lateral deslizável em tela larga com toque (tablet)."""
    ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                              timezone_id="America/Sao_Paulo", locale="pt-BR")
    pg = ctx.new_page()
    pg.clock.set_fixed_time(NOW)
    r = Run(pg, shots_dir / "celular" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    r.signup("Rita", "rita@teste.com")
    r.create_company("Faixa Ltda")
    me = pg.evaluate("state.uid")
    for i, prio in enumerate(["baixa", "neutra", "alta", "neutra", "baixa"]):
        r.click("#nfab")
        pg.fill("#f_t", f"Tarefa {i} {prio}")
        pg.fill("#f_d", "Teste")
        pg.select_option("#f_p", prio)
        pg.check(f'.f_e[value="{me}"]')
        r.click("#f_go")
    r.tab("agenda")
    # Contador na aba Tarefas: 5 esperando aceite.
    assert pg.inner_text('nav [data-tab="tarefas"] .badge') == "5"
    # Celular: lista vertical, mais urgente primeiro, só 3 visíveis + "Ver todas".
    visible = pg.eval_on_selector_all(".strip.waiting .card", "e => e.filter(x => x.offsetParent).map(x => x.querySelector('b').innerText)")
    assert len(visible) == 3 and "alta" in visible[0], visible
    assert pg.evaluate("getComputedStyle(document.querySelector('.strip.waiting')).flexDirection") == "column"
    r.shot("lista-celular")
    r.click('[data-seeall="1"]')
    assert pg.eval_on_selector_all(".strip.waiting .card", "e => e.filter(x => x.offsetParent).length") == 5
    assert "Mostrar menos" in pg.inner_text('[data-seeall="1"]')

    cdp = ctx.new_cdp_session(pg)

    def touch(points):
        (x0, y0), rest = points[0], points[1:]
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
        for x, y in rest:
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        r.wait(400)

    # Arrastar pela alça ⠿ (toque) até 10:00 agenda a tarefa; o contador diminui.
    tid = pg.get_attribute(".strip.waiting .card", "data-tid")
    pg.select_option(f'.dsel[data-i="{tid}"]', "30")
    r.wait()
    pg.evaluate("window.scrollTo(0, 0)")
    pg.set_viewport_size({"width": 412, "height": 2600})  # alça e horário na tela ao mesmo tempo
    r.wait()
    grip = pg.locator(f'.strip [data-tid="{tid}"] .drag-handle').bounding_box()
    target = pg.locator(f'.slot[data-t="{ms(10)}"]').bounding_box()
    gx, gy = grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2
    tx, ty = target["x"] + 40, target["y"] + target["height"] / 2
    touch([(gx, gy)] + [(gx + (tx - gx) * k / 12, gy + (ty - gy) * k / 12) for k in range(1, 13)])
    t = pg.evaluate(f"state.tasks['{tid}']")
    assert t["status"] == "agendada" and t["start"] == ms(10), t
    assert pg.inner_text('nav [data-tab="tarefas"] .badge') == "4"

    # Tablet (tela larga, toque): faixa lateral que desliza em qualquer parte do cartão (até no título).
    pg.set_viewport_size({"width": 1024, "height": 900})
    r.wait()
    assert pg.evaluate("getComputedStyle(document.querySelector('.strip.waiting')).flexDirection") == "row"
    strip_left = lambda: pg.evaluate("document.querySelector('.strip').scrollLeft")
    assert pg.evaluate("(() => { const s = document.querySelector('.strip'); return s.scrollWidth > s.clientWidth; })()")
    first = pg.locator(".strip .card").first
    for part in (".task-time", ".drag-row b", ".dsel"):
        pg.evaluate("document.querySelector('.strip').scrollLeft = 0")
        box = first.locator(part).first.bounding_box()
        y = box["y"] + box["height"] / 2
        x0 = box["x"] + box["width"] - 12  # dentro do 1º cartão, longe da alça ⠿
        touch([(x0, y)] + [(x0 - 20 * k, y) for k in range(1, 11)])
        assert strip_left() > 100, (part, strip_left())
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def email_confirmation_flow(browser, shots_dir):
    """Tela "Confirme seu e-mail" (após o cadastro) e a página confirmado.html (link do e-mail)."""
    ctx = browser.new_context(viewport={"width": 420, "height": 900}, locale="pt-BR")
    pg = ctx.new_page()
    r = Run(pg, shots_dir / "email" if shots_dir else None)
    if r.shots_dir:
        r.shots_dir.mkdir(exist_ok=True)
    pg.goto(INDEX)
    pg.wait_for_selector("#a_go")
    pg.evaluate("showConfirmEmail('nova@teste.com')")
    txt = r.shot("confirme-email")
    assert "Confirme seu e-mail" in txt and "nova@teste.com" in txt, txt
    r.click("#a_back")
    assert pg.input_value("#a_e") == "nova@teste.com"

    # Celular: recarregar a página (puxar para atualizar / aba descartada) não apaga o cadastro (só a senha).
    if not pg.query_selector("#a_n"):
        r.click("#a_mode")
    for sel, v in [("#a_n", "Maria"), ("#a_u", "maria"), ("#a_e", "maria@teste.com"), ("#a_p", "segredo1")]:
        pg.fill(sel, v)
    pg.evaluate("renderLoggedOut()")  # redesenho da mesma tela mantém tudo, inclusive a senha
    assert pg.input_value("#a_p") == "segredo1" and pg.input_value("#a_n") == "Maria"
    pg.reload()
    pg.wait_for_selector("#a_n")
    assert [pg.input_value(s) for s in ("#a_n", "#a_u", "#a_e", "#a_p")] == ["Maria", "maria", "maria@teste.com", ""]
    assert "segredo1" not in (pg.evaluate("sessionStorage.getItem('tm_draft')") or "")
    assert pg.evaluate("getComputedStyle(document.documentElement).overscrollBehaviorY") == "none"
    pg.fill("#a_p", "123456")
    pg.check("#a_k")
    r.click("#a_go")
    pg.wait_for_selector("#ob_cn")
    assert pg.evaluate("sessionStorage.getItem('tm_draft')") is None  # cadastro feito: rascunho apagado
    # Criar empresa: o rascunho volta após recarregar (e o CEP refaz a busca de cidade/UF).
    pg.fill("#ob_cn", "Empresa Rascunho")
    r.fill_address(num="42")
    pg.reload()
    pg.wait_for_selector("#ob_cn")
    pg.wait_for_function("document.querySelector('#ob_cid').value === 'São Paulo'")
    assert pg.input_value("#ob_cn") == "Empresa Rascunho" and pg.input_value("#ob_num") == "42"
    r.click("#ob_create")
    pg.wait_for_selector("#cs_done")
    assert pg.evaluate("sessionStorage.getItem('tm_draft')") is None

    page = (ROOT / "confirmado.html").as_uri()
    pg.goto(page + "#access_token=abc&refresh_token=def&type=signup")
    pg.wait_for_selector("#c_enter")
    txt = r.shot("email-confirmado")
    assert "E-mail confirmado!" in txt, txt
    assert "access_token" not in pg.url  # tokens saem da barra de endereço
    r.click("#c_enter")
    pg.wait_for_selector("#a_go")  # volta para o sistema (tela de login)

    pg.goto(page + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
    pg.wait_for_selector("#c_go")
    txt = r.shot("link-expirado")
    assert "Link inválido ou expirado" in txt, txt
    r.click("#c_go")
    assert "e-mail válido" in pg.inner_text("#c_m")
    assert not r.errors, r.errors
    ctx.close()
    return len(r.shots)


def device_status(r, did):
    return r.pg.evaluate(f"JSON.parse(localStorage.getItem('tm_db_v1'))['devices/{did}'].status")


def toast(r):
    return r.pg.inner_text("#toast")


def layout(r):
    """Organização salva dos aparelhos da funcionária, simplificada para comparação."""
    ws = r.pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('tm_db_v1')))"
                       ".find(([k, v]) => k.startsWith('profiles/') && v.role === 'func')[1].ws")
    out = []
    for x in ws.get("layout") or []:
        out.append(("group", x["name"], x["items"]) if x["type"] == "group" else ("dev", x["id"]))
    return out


def drag(r, src, dst, fy=0.5, fx=0.5):
    """Arrasta com o mouse de `src` até `dst` (fy: fração da altura; negativo = px a partir de baixo)."""
    pg = r.pg
    s = pg.locator(src).first.bounding_box()
    d = pg.locator(dst).first.bounding_box()
    y = d["y"] + d["height"] + fy if fy < 0 else d["y"] + d["height"] * fy
    pg.mouse.move(s["x"] + s["width"] / 2, s["y"] + min(30, s["height"] / 2))
    pg.mouse.down()
    pg.mouse.move(d["x"] + d["width"] * fx, y, steps=15)
    pg.mouse.up()
    r.wait(250)


def extra_flows(r):
    """Fluxos complementares: arrasto com mouse, conta, categorias, troca de conta, temas/desktop."""
    pg = r.pg
    ana_id = r.uid_of("ana@teste.com")
    bruno_id = r.uid_of("bruno@teste.com")
    # Bruno pede mais uma tarefa para Ana.
    r.click("#nfab")
    pg.fill("#f_t", "Configurar VPN")
    pg.fill("#f_d", "Acesso remoto")
    pg.check(f'.f_e[value="{ana_id}"]')
    r.click("#f_go")
    r.logout()

    # Ana arrasta o cartão com o mouse até 14:00.
    r.login("ana@teste.com")
    vpn = pg.get_attribute(".strip [data-tid]", "data-tid")
    pg.select_option(f'.dsel[data-i="{vpn}"]', "45")
    r.wait()
    pg.set_viewport_size({"width": 420, "height": 2000})  # cartão e horário visíveis ao mesmo tempo
    r.wait()
    slot = pg.locator(f'.slot[data-t="{ms(14)}"]')
    handle = pg.locator(f'.strip [data-tid="{vpn}"] .drag-row').bounding_box()
    pg.mouse.move(handle["x"] + 20, handle["y"] + 10)
    pg.mouse.down()
    target = slot.bounding_box()
    pg.mouse.move(target["x"] + 40, target["y"] + 10, steps=12)
    pg.mouse.up()
    r.wait(300)
    task = pg.evaluate(f"JSON.parse(localStorage.getItem('tm_db_v1'))['tasks/{vpn}']")
    assert task["status"] == "agendada" and task["start"] == ms(14), task
    pg.set_viewport_size({"width": 420, "height": 900})

    # Horário de trabalho: validação e reagendamento do que ficar fora da jornada.
    r.menu("folgas")
    pg.fill("#p_s", "08:00")
    pg.fill("#p_e", "07:00")
    r.click("#wh_go")
    assert toast(r) == "A saída precisa ser depois da entrada.", toast(r)
    pg.fill("#p_e", "14:30")
    pg.fill("#p_bs", "15:00")
    pg.fill("#p_be", "15:30")
    r.click("#wh_go")
    assert toast(r) == "O almoço precisa ficar dentro do horário de trabalho.", toast(r)
    pg.fill("#p_bs", "11:30")
    pg.fill("#p_be", "12:30")
    r.click("#wh_go")
    r.wait(300)
    assert toast(r) == "Horário de trabalho salvo.", toast(r)
    prof = pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('tm_db_v1'))).find(([k, v]) => k.startsWith('profiles/') && v.role === 'func')[1]")
    assert (prof["start"], prof["end"], prof["bs"], prof["be"]) == ("08:00", "14:30", "11:30", "12:30"), prof
    task = pg.evaluate(f"JSON.parse(localStorage.getItem('tm_db_v1'))['tasks/{vpn}']")
    assert task["status"] == "agendada" and task["start"] == ms(9), task  # 14:00–14:45 não cabe mais
    assert any("horário de trabalho alterado" in h["x"] for h in task["hist"]), task["hist"]
    r.shot("horario-trabalho")

    # Troca de senha e de e-mail; login com os novos dados.
    r.menu("perfil")
    pg.fill("#pw_c", "errada")
    pg.fill("#pw_n", "abcdef")
    r.click("#pw_go")
    r.wait(400)
    assert toast(r) == "Senha atual incorreta.", toast(r)
    pg.fill("#pw_c", "123456")
    pg.fill("#pw_n", "abcdef")
    r.click("#pw_go")
    r.wait(400)
    assert toast(r) == "Senha alterada.", toast(r)
    pg.fill("#em_n", "bruno@teste.com")
    pg.fill("#em_p", "abcdef")
    r.click("#em_go")
    r.wait(400)
    assert toast(r) == "Este e-mail já está em uso.", toast(r)
    pg.fill("#em_n", "ana2@teste.com")
    pg.fill("#em_p", "abcdef")
    r.click("#em_go")
    r.wait(400)
    assert toast(r) == "E-mail alterado.", toast(r)
    r.logout()
    pg.fill("#a_e", "ana@teste.com")
    pg.fill("#a_p", "abcdef")
    r.click("#a_go")
    r.wait(400)
    assert "incorretos" in pg.inner_text("#a_m")
    r.login("ana2@teste.com", "abcdef")

    # Categoria com ícone PNG: cria e exclui (administrador, aba Empresa).
    r.logout()
    r.login("carlos@teste.com")
    r.tab("empresa")
    pg.fill("#wc_n", "Roteador")
    pg.set_input_files("#wc_f", files=[{"name": "r.png", "mimeType": "image/png", "buffer": PNG_1PX}])
    r.click("#wc_add")
    r.wait(300)
    assert pg.locator('[data-cat="Roteador"] img').count() == 1
    r.click('[data-cdel="Roteador"]')
    r.click("#cd_ok")
    assert pg.locator('[data-cat="Roteador"]').count() == 0
    r.logout()
    r.login("ana2@teste.com", "abcdef")

    # Novo aparelho pela Área de Trabalho.
    r.tab("workstation")
    r.click('[data-wst="new"]')
    pg.select_option("#dv_a", "Computador")
    pg.fill("#dv_n", "PC Caixa")
    pg.fill("#dv_i", "10.0.0.5")
    r.click("#dv_add")
    assert pg.locator("[data-dev]").count() == 2
    hp = pg.get_attribute('.device-card:has-text("HP Recepção")', "data-did")
    pc = pg.get_attribute('.device-card:has-text("PC Caixa")', "data-did")

    # Organização dos aparelhos: começa com um grupo por categoria.
    heads = pg.eval_on_selector_all("#dv_board .dev-group h3", "e => e.map(x => x.textContent)")
    assert heads == ["⠿🖨️ Impressora (1)", "⠿💻 Computador (1)"], heads
    pg.set_viewport_size({"width": 420, "height": 2400})
    r.wait()
    card = lambda did: f'.device-card[data-did="{did}"]'
    drag(r, card(hp), "#dv_board", fy=-15)          # solta fora dos grupos
    assert layout(r) == [("group", "Computador", [pc]), ("dev", hp)], layout(r)
    drag(r, card(pc), "#dv_board", fy=-15)
    assert layout(r) == [("dev", hp), ("dev", pc)], layout(r)
    drag(r, card(pc), card(hp), fy=0.5)             # sobre outro aparelho: cria grupo
    assert "Grupo criado" in pg.inner_text("#mdb")
    pg.fill("#gr_n", "Rede")
    r.click("#gr_ok")
    assert layout(r) == [("group", "Rede", [hp, pc])], layout(r)
    drag(r, card(pc), card(hp), fy=0.1)             # borda de cima: reordena dentro do grupo
    assert layout(r) == [("group", "Rede", [pc, hp])], layout(r)
    r.click("[data-grename]")
    pg.fill("#gr_n", "Rede local")
    pg.keyboard.press("Enter")
    r.wait()
    assert layout(r) == [("group", "Rede local", [pc, hp])], layout(r)
    r.click("[data-gungroup]")
    assert layout(r) == [("dev", pc), ("dev", hp)], layout(r)
    drag(r, card(hp), card(pc), fy=0.1)             # reordena aparelhos soltos
    assert layout(r) == [("dev", hp), ("dev", pc)], layout(r)
    drag(r, card(pc), card(hp), fy=0.5)
    r.click("#dn_no")                               # mantém o nome sugerido
    assert layout(r) == [("group", "Grupo 1", [hp, pc])], layout(r)
    r.shot("ws-grupos")

    # Aparelho novo entra no fim; o grupo pode ser arrastado para depois dele.
    r.click('[data-wst="new"]')
    pg.select_option("#dv_a", "Computador")
    pg.fill("#dv_n", "Lixo")
    pg.fill("#dv_i", "10.0.0.9")
    r.click("#dv_add")
    lixo = pg.get_attribute('.device-card:has-text("Lixo")', "data-did")
    order = pg.eval_on_selector_all("#dv_board > *", "e => e.map(x => x.className)")
    assert order == ["dev-group", "device-grid loose"], order  # novo aparelho aparece solto, no fim
    gid = pg.get_attribute("#dv_board .dev-group", "data-gid")
    drag(r, f'.dev-group[data-gid="{gid}"] .dev-group-head h3', card(lixo), fy=0.9)
    assert layout(r) == [("dev", lixo), ("group", "Grupo 1", [hp, pc])], layout(r)
    pg.set_viewport_size({"width": 420, "height": 900})

    # Exclusão com confirmação (e o aparelho some da organização).
    r.menu("wcfg")
    r.click(f'[data-ddel="{lixo}"]')
    assert pg.inner_text(f'[data-ddel="{lixo}"]') == "Confirmar exclusão"
    r.click(f'[data-ddel="{lixo}"]')
    assert pg.locator(f'[data-ddel="{lixo}"]').count() == 0
    assert layout(r) == [("group", "Grupo 1", [hp, pc])], layout(r)

    # Trocar de conta pelo menu (sem senha).
    r.click("#mnb")
    r.click('[data-sw="1"]')
    r.click(f'#mn_b [data-acc="{bruno_id}"]')
    pg.wait_for_selector('nav [data-tab="equipe"]')
    assert r.tabs() == ["Agenda", "Tarefas", "Equipe", "Aparelhos"], r.tabs()
    # Aba Aparelhos do solicitante: agrupada por categoria; só as categorias se movem.
    r.tab("aparelhos")
    heads = lambda: pg.eval_on_selector_all("#cat_board .dev-group h3", "e => e.map(x => x.textContent)")
    assert heads() == ["⠿🖨️ Impressora (1)", "⠿💻 Computador (1)"], heads()
    assert pg.locator(".dv-handle, [data-grename], [data-gungroup]").count() == 0
    pg.set_viewport_size({"width": 420, "height": 2000})
    r.wait()
    ana_layout = layout(r)
    drag(r, card(hp), card(pc), fy=0.5)              # aparelho não se move
    assert heads() == ["⠿🖨️ Impressora (1)", "⠿💻 Computador (1)"], heads()
    drag(r, '.dev-group[data-gid="Computador"] .group-handle', '.dev-group[data-gid="Impressora"]', fy=0.1)
    assert heads() == ["⠿💻 Computador (1)", "⠿🖨️ Impressora (1)"], heads()
    order = pg.evaluate("Object.entries(JSON.parse(localStorage.getItem('tm_db_v1')))"
                        ".find(([k, v]) => k.startsWith('profiles/') && v.role === 'sol')[1].devCatOrder")
    assert order == ["Computador", "Impressora"], order
    assert layout(r) == ana_layout  # organização da funcionária não muda
    pg.set_viewport_size({"width": 420, "height": 900})
    r.shot("aparelhos-solicitante")

    # Manutenção cancelada: o aparelho volta ao status anterior.
    pc_card = f'.device-card[data-did="{pc}"]'
    assert device_status(r, pc) == "Operacional"
    r.click("#nfab")
    pg.select_option("#f_v", pc)
    r.wait()
    pg.check(f'.f_e[value="{ana_id}"]')
    pg.fill("#f_t", "Teclado falhando")
    pg.fill("#f_d", "Teclas não respondem")
    r.click("#f_go")
    assert device_status(r, pc) == "Inoperante"
    assert "status: inoperante" in pg.inner_text(pc_card)
    r.tab("tarefas")
    r.click('[data-tf="ativas"]')
    tid = pg.eval_on_selector_all("[data-tid]", "e => e.find(x => x.textContent.includes('Teclado')).dataset.tid")
    r.click(f'[data-a="cancelar"][data-i="{tid}"]')
    assert device_status(r, pc) == "Operacional"

    # Tema escuro e layout de desktop (capturas para revisão visual).
    r.menu("perfil")
    r.click('[data-th="dark"]')
    r.tab("agenda")
    r.shot("escuro-agenda")
    pg.set_viewport_size({"width": 1280, "height": 900})
    r.shot("desktop-agenda")
    r.menu("perfil")
    r.click('[data-th="light"]')


if __name__ == "__main__":
    main()
