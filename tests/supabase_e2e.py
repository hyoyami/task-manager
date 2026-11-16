"""Teste de integração com o Supabase de verdade (banco, login, empresas, tempo real e permissões).

Abre quatro navegadores ao mesmo tempo — administrador, funcionário, solicitante e alguém de
outra empresa — e confere: criação da empresa, convite por link, pedido de entrada aprovado em
tempo real, mudanças de um aparecendo no outro sem recarregar, isolamento entre empresas e as
regras de segurança (RLS + gatilho do perfil) bloqueando tentativas de burlar.
No final apaga os usuários e dados criados.

Requer:
  - pip install playwright && playwright install chromium
  - Confirmação de e-mail desligada no projeto (Authentication → Sign In / Providers → Email)
  - Para a limpeza: token de acesso do Supabase em ~/.supabase-token (Account → Access Tokens)
Uso:  python tests/supabase_e2e.py
"""
import functools
import http.server
import json
import pathlib
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROJECT_REF = "fguabpdfmqjcmvrpdicg"
STAMP = str(int(time.time()))
EMAIL_PREFIX = "tm-e2e-"
ADMIN_EMAIL = f"{EMAIL_PREFIX}{STAMP}-admin@example.com"
FUNC_EMAIL = f"{EMAIL_PREFIX}{STAMP}-func@example.com"
SOL_EMAIL = f"{EMAIL_PREFIX}{STAMP}-sol@example.com"
OUT_EMAIL = f"{EMAIL_PREFIX}{STAMP}-fora@example.com"
PASSWORD = "senha-teste-123"


def serve():
    """Servidor HTTP local para a pasta do projeto (como o iniciar.sh)."""
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/index.html"


def sql(query):
    """Executa SQL pela API de gerenciamento do Supabase (só para a limpeza)."""
    token = (pathlib.Path.home() / ".supabase-token").read_text().strip()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "task-manager-tests"},
        method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"[]")


def cleanup():
    """Apaga os usuários de teste (tm-e2e-*) e tudo o que eles criaram."""
    ids = "(select id::text from auth.users where email like '" + EMAIL_PREFIX + "%@example.com')"
    sql(f"""
      delete from public.notifs    where to_user in {ids};
      delete from public.tutorials where data->>'by' in {ids};
      delete from public.tasks     where req in {ids} or emp in {ids};
      delete from public.devices   where owner in {ids};
      delete from public.invites   where data->>'by' in {ids};
      delete from public.profiles  where id in {ids};
      delete from public.companies where admin in {ids};
      delete from auth.users where email like '{EMAIL_PREFIX}%@example.com';
    """)


class User:
    def __init__(self, browser, url, label):
        self.ctx = browser.new_context(viewport={"width": 420, "height": 1000}, locale="pt-BR",
                                       timezone_id="America/Sao_Paulo")
        self.pg = self.ctx.new_page()
        self.label = label
        self.errors = []
        self.pg.on("pageerror", lambda e: self.errors.append(f"[{label}] {e}"))
        self.pg.goto(url)

    def wait(self, ms=300):
        self.pg.wait_for_timeout(ms)

    def click(self, sel):
        self.pg.click(sel)
        self.wait()

    def signup(self, name, email):
        pg = self.pg
        pg.wait_for_selector("#a_go", timeout=20000)
        if not pg.query_selector("#a_n"):
            self.click("#a_mode")
        pg.fill("#a_n", name)
        pg.fill("#a_e", email)
        pg.fill("#a_p", PASSWORD)
        pg.check("#a_k")
        self.click("#a_go")
        try:
            pg.wait_for_selector("nav button, #ob_cn", timeout=20000)
        except Exception:
            raise AssertionError(f"[{self.label}] cadastro falhou: {pg.inner_text('#a_m')}")
        self.wait(500)

    def db_call(self, js):
        """Executa uma operação do banco pela API do app, devolvendo 'ok' ou a mensagem de erro."""
        return self.pg.evaluate("""async (code) => {
          const db = await claude.use('db');
          try { await (new Function('db', 'return (async () => {' + code + '})()'))(db); return 'ok'; }
          catch (e) { return 'erro: ' + e.message; }
        }""", js)


def main():
    srv, url = serve()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            admin = User(browser, url, "administrador")
            func = User(browser, url, "funcionário")
            sol = User(browser, url, "solicitante")
            out = User(browser, url, "outra empresa")
            for u in (admin, func, sol, out):
                u.pg.on("dialog", lambda d: d.accept())

            # Administrador cria a empresa e cadastra um aparelho.
            admin.signup("Adm Teste", ADMIN_EMAIL)
            admin.pg.fill("#ob_cn", "Empresa E2E " + STAMP)
            admin.click("#ob_create")
            admin.pg.wait_for_selector('nav [data-tab="empresa"]', timeout=15000)
            company = admin.pg.evaluate("state.company.id")
            admin.click('nav [data-tab="workstation"]')
            admin.click('[data-wst="new"]')
            admin.pg.select_option("#dv_a", "Impressora")
            admin.pg.fill("#dv_n", "Impressora Teste")
            admin.pg.fill("#dv_i", "10.1.1.1")
            admin.click("#dv_add")
            admin.pg.wait_for_selector(".device-card", timeout=15000)
            dev_id = admin.pg.get_attribute(".device-card", "data-did")

            # Link de convite de funcionário → o funcionário entra direto.
            admin.click('nav [data-tab="empresa"]')
            admin.pg.select_option("#adm_ir", "func")
            admin.click("#adm_inv")
            admin.pg.wait_for_function("Object.keys(state.invites).length === 1", timeout=15000)
            link = admin.pg.evaluate("inviteLink(Object.keys(state.invites)[0])")
            func.pg.goto(link)
            func.signup("Fábio Teste", FUNC_EMAIL)
            func.pg.wait_for_selector('nav [data-tab="workstation"]', timeout=20000)
            func_id = func.pg.evaluate("state.uid")
            assert len(func_id) == 36, func_id  # uuid do Supabase Auth
            func.click('nav [data-tab="workstation"]')
            func.pg.select_option("#w_c", "ti")
            func.click("#w_save")
            func.pg.wait_for_selector(f'.device-card[data-did="{dev_id}"]', timeout=15000)

            # Solicitante pede entrada pela lista; não consegue se autoaprovar.
            sol.signup("Sara Teste", SOL_EMAIL)
            sol.pg.wait_for_selector(f'#ob_company option[value="{company}"]', state="attached", timeout=15000)
            sol.pg.select_option("#ob_company", company)
            sol.pg.select_option("#ob_role", "sol")
            sol.click("#ob_join")
            sol.pg.wait_for_selector("#ob_cancel", timeout=15000)
            sol_id = sol.pg.evaluate("state.uid")
            r = sol.db_call(f"await db.doc('profiles/{sol_id}').update({{ status: 'active' }})")
            assert r.startswith("erro"), "autoaprovação deveria ser bloqueada: " + r
            r = sol.db_call(f"await db.doc('profiles/{sol_id}').update({{ role: 'admin', status: 'active' }})")
            assert r.startswith("erro"), r
            assert sol.pg.evaluate("Object.keys(state.devices).length") == 0  # pendente não vê nada

            # O pedido chega ao administrador em tempo real; ele aceita e a tela do solicitante abre sozinha.
            admin.pg.wait_for_function("state.joinRequests.length === 1", timeout=15000)
            admin.click('nav [data-tab="empresa"]')
            admin.click(f'[data-accept="{sol_id}"]')
            sol.pg.wait_for_selector('nav [data-tab="aparelhos"]', timeout=20000)

            # Tempo real: o solicitante vê o aparelho da empresa.
            sol.click('nav [data-tab="aparelhos"]')
            sol.pg.wait_for_selector(f'.device-card[data-did="{dev_id}"]', timeout=15000)

            # Solicitante abre uma manutenção para o funcionário → aparelho fica Inoperante.
            sol.click("#nfab")
            sol.pg.select_option("#f_v", dev_id)
            sol.wait()
            sol.pg.check(f'.f_e[value="{func_id}"]')
            sol.click('[data-pk="Limpeza"]')
            sol.click("#f_go")
            sol.pg.wait_for_selector(f'.device-card[data-did="{dev_id}"]:has-text("inoperante")', timeout=15000)

            # O funcionário recebe a tarefa em tempo real, define a duração e aceita.
            func.click('nav [data-tab="agenda"]')
            func.pg.wait_for_selector(".strip [data-tid]", timeout=15000)
            tid = func.pg.get_attribute(".strip [data-tid]", "data-tid")
            func.pg.select_option(f'.dsel[data-i="{tid}"]', "30")
            func.wait(800)
            func.click(f'.strip [data-a="aceitar"][data-i="{tid}"]')
            func.wait(800)
            status = func.pg.evaluate(f"state.tasks['{tid}'].status")
            assert status in ("agendada", "pendente"), status
            sol.pg.wait_for_function("state.notifs.some(n => /aceita/.test(n.txt))", timeout=15000)

            # Segurança dentro da empresa.
            r = sol.db_call(f"await db.doc('profiles/{func_id}').update({{ name: 'Hacker' }})")
            assert r.startswith("erro"), r
            r = func.db_call(f"await db.doc('profiles/{func_id}').update({{ role: 'admin' }})")
            assert r.startswith("erro"), "funcionário não pode virar administrador: " + r
            sol.db_call(f"await db.doc('devices/{dev_id}').delete()")  # RLS: apaga 0 linhas
            func.wait(2000)
            assert func.pg.evaluate(f"!!state.devices['{dev_id}']"), "aparelho não deveria ser apagado"
            r = func.db_call(f"await db.collection('tasks').doc().set({{ company: '{company}', title: 'x', req: '{sol_id}', emp: '{func_id}' }})")
            assert r.startswith("erro"), r

            # Outra empresa não enxerga nada desta (nem forçando pela API).
            out.signup("Otto Fora", OUT_EMAIL)
            out.pg.fill("#ob_cn", "Outra E2E " + STAMP)
            out.click("#ob_create")
            out.pg.wait_for_selector('nav [data-tab="empresa"]', timeout=15000)
            leaked = out.pg.evaluate("""async () => {
              const db = await claude.use('db');
              const count = (name) => new Promise((ok) => {
                const off = db.collection(name).onSnapshot((s) => { off(); ok(s.docs.length); });
              });
              return { tasks: await count('tasks'), devices: await count('devices'), invites: await count('invites') };
            }""")
            assert leaked == {"tasks": 0, "devices": 0, "invites": 0}, leaked
            r = out.db_call(f"await db.doc('devices/{dev_id}').update({{ status: 'Fora de uso' }})")
            assert r.startswith("erro"), r
            r = out.db_call(f"await db.call('join_with_invite', {{ code: 'codigo-inexistente' }})")
            assert r.startswith("erro"), r

            # Persistência: recarregar mantém a sessão e os dados vêm do banco.
            func.pg.reload()
            func.pg.wait_for_selector("nav button", timeout=20000)
            func.pg.wait_for_function(f"!!state.tasks['{tid}']", timeout=15000)

            # Sair encerra a sessão.
            func.click("#mnb")
            func.click("#a_out")
            func.pg.wait_for_selector("#a_go", timeout=10000)

            errors = admin.errors + func.errors + sol.errors + out.errors
            assert not errors, errors
            print("OK: Supabase — empresa, convite, aprovação, tempo real, isolamento, RLS e persistência.")
            browser.close()
    finally:
        srv.shutdown()
        try:
            cleanup()
            print("Limpeza: usuários e dados de teste removidos.")
        except Exception as e:  # sem token, a limpeza fica manual
            print("Aviso: não foi possível limpar os dados de teste:", e)


if __name__ == "__main__":
    main()
