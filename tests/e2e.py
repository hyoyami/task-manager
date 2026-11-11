"""Teste ponta a ponta do TASK MANAGER (Playwright + banco local).

Percorre os fluxos principais com o relógio do navegador fixo (quarta-feira,
11/11/2026, 09:00 em São Paulo) para que o resultado seja determinístico:

  funcionário: cadastro, configuração da Workstation, aparelho, folgas,
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
INDEX = (ROOT / "index.html").as_uri()
TZ = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2026, 11, 11, 9, 0, tzinfo=TZ)


def ms(h, m=0, day=11):
    return int(datetime(2026, 11, day, h, m, tzinfo=TZ).timestamp() * 1000)


class Run:
    def __init__(self, page, shots_dir=None):
        self.pg = page
        self.shots_dir = shots_dir
        self.shots = []
        self.errors = []
        page.on("pageerror", lambda e: self.errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and self.errors.append(m.text))

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
        self.pg.click(sel)
        self.wait()

    def tab(self, key):
        self.click(f'nav [data-tab="{key}"]')

    def menu(self, go):
        self.click("#mnb")
        self.click(f'#mn_b [data-go="{go}"]')

    def signup(self, name, email, role):
        pg = self.pg
        pg.wait_for_selector("#a_go")
        if not pg.query_selector("#a_n"):
            self.click("#a_mode")
        pg.fill("#a_n", name)
        pg.fill("#a_e", email)
        pg.fill("#a_p", "123456")
        pg.select_option("#a_r", role)
        pg.check("#a_k")
        self.click("#a_go")
        pg.wait_for_selector("nav button")
        self.wait()

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

        # ---------- Funcionária Ana: cadastro e Workstation ----------
        r.signup("Ana", "ana@teste.com", "func")
        assert r.tabs() == ["Agenda", "Tarefas", "Workstation"], r.tabs()
        r.shot("ana-agenda-vazia")
        r.tab("workstation")
        r.shot("ws-setup1")
        pg.select_option("#w_c", "ti")
        r.click("#w_save")
        r.shot("ws-setup2")
        pg.select_option("#dv_a", "Impressora")
        pg.fill("#dv_n", "HP Recepção")
        pg.fill("#dv_i", "192.168.0.300")
        r.click("#dv_add")  # IP inválido -> recusado
        assert "IP v" in pg.inner_text("#toast")
        pg.fill("#dv_i", "192.168.0.10")
        r.click("#dv_add")
        r.click("#w_done")
        r.shot("ws-lista")
        dev_id = pg.get_attribute("[data-dev]", "data-dev")
        r.click(f'[data-dev="{dev_id}"]')
        pg.select_option(".dv_st", "Fora de uso")
        r.wait()
        pg.fill("#dv_t", "Troca de toner")
        r.click(f'[data-lg="{dev_id}"]')
        r.shot("dev-modal", "#mdb")
        r.click("#dn_no")

        # Configuração da Workstation: problemas de categoria
        r.menu("wcfg")
        r.shot("wcfg")
        r.click('[data-cat="Impressora"]')
        pg.fill("#pb_n", "Sem tinta")
        r.click("#pb_add")
        r.shot("cat-modal", "#mdb")
        r.click("#dn_no")

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

        # ---------- Solicitante Bruno ----------
        r.signup("Bruno", "bruno@teste.com", "sol")
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
        pg.check(".f_e")
        pg.select_option("#f_p", "alta")
        r.click("#f_go")
        # Tarefa de manutenção (aparelho + problema pré-definido)
        r.click("#nfab")
        pg.select_option("#f_v", dev_id)
        r.wait()
        r.shot("nova-com-aparelho", "#mdb")
        r.click('[data-pk="Limpeza"]')
        r.click("#f_go")
        # O aparelho vinculado fica inoperante até o funcionário iniciar (visível na aba Aparelhos).
        assert device_status(r, dev_id) == "Inoperante"
        r.tab("aparelhos")
        assert "status: inoperante" in pg.inner_text(f'.device-card[data-did="{dev_id}"]')
        # Terceira tarefa, que será cancelada pelo solicitante
        r.click("#nfab")
        pg.fill("#f_t", "Trocar mouse")
        pg.fill("#f_d", "Mouse quebrado")
        pg.check(".f_e")
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
    r.signup("Carla", "carla@teste.com", "func")
    r.logout()
    r.signup("Davi", "davi@teste.com", "sol")
    for title, prio in [("Em curso", "neutra"), ("Baixa 1", "baixa"), ("Neutra 1", "neutra"), ("Urgente", "alta")]:
        r.click("#nfab")
        pg.fill("#f_t", title)
        pg.fill("#f_d", "Teste de prioridade")
        pg.check(".f_e")
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
    # Bruno pede mais uma tarefa para Ana.
    r.click("#nfab")
    pg.fill("#f_t", "Configurar VPN")
    pg.fill("#f_d", "Acesso remoto")
    pg.check(".f_e")
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
    handle = pg.locator(f'.strip [data-tid="{vpn}"] .drag-handle').bounding_box()
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

    # Categoria com ícone PNG: cria e exclui.
    r.menu("wcfg")
    pg.fill("#wc_n", "Roteador")
    pg.set_input_files("#wc_f", files=[{"name": "r.png", "mimeType": "image/png", "buffer": PNG_1PX}])
    r.click("#wc_add")
    r.wait(300)
    assert pg.locator('[data-cat="Roteador"] img').count() == 1
    r.click('[data-cdel="Roteador"]')
    r.click("#cd_ok")
    assert pg.locator('[data-cat="Roteador"]').count() == 0

    # Novo aparelho pela Workstation.
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
    r.click("#mn_b [data-acc]")
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
