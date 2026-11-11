"""Teste de integração com o Supabase de verdade (banco, login, tempo real e permissões).

Abre dois navegadores ao mesmo tempo — funcionário e solicitante — e confere que as
mudanças de um aparecem no outro sem recarregar a página, e que as regras de segurança
(RLS) bloqueiam o que devem bloquear. No final apaga os usuários e dados criados.

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
FUNC_EMAIL = f"{EMAIL_PREFIX}{STAMP}-func@example.com"
SOL_EMAIL = f"{EMAIL_PREFIX}{STAMP}-sol@example.com"
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
      delete from public.profiles  where id in {ids};
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

    def signup(self, name, email, role):
        pg = self.pg
        pg.wait_for_selector("#a_go", timeout=20000)
        if not pg.query_selector("#a_n"):
            self.click("#a_mode")
        pg.fill("#a_n", name)
        pg.fill("#a_e", email)
        pg.fill("#a_p", PASSWORD)
        pg.select_option("#a_r", role)
        pg.check("#a_k")
        self.click("#a_go")
        try:
            pg.wait_for_selector("nav button", timeout=20000)
        except Exception:
            raise AssertionError(f"[{self.label}] cadastro falhou: {pg.inner_text('#a_m')}")

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
            func = User(browser, url, "funcionário")
            sol = User(browser, url, "solicitante")

            # Cadastro real no Supabase Auth.
            func.signup("Fábio Teste", FUNC_EMAIL, "func")
            sol.signup("Sara Teste", SOL_EMAIL, "sol")
            func_id = func.pg.evaluate("state.uid")
            sol_id = sol.pg.evaluate("state.uid")
            assert len(func_id) == 36 and len(sol_id) == 36, (func_id, sol_id)  # uuid do Supabase Auth

            # Funcionário configura a Workstation e cadastra um aparelho.
            func.click('nav [data-tab="workstation"]')
            func.pg.select_option("#w_c", "ti")
            func.click("#w_save")
            func.pg.wait_for_selector("#dv_n")
            func.pg.fill("#dv_n", "Impressora Teste")
            func.pg.fill("#dv_i", "10.1.1.1")
            func.click("#dv_add")
            func.click("#w_done")
            func.pg.wait_for_selector(".device-card")
            dev_id = func.pg.get_attribute(".device-card", "data-did")

            # Tempo real: o solicitante vê o funcionário e o aparelho sem recarregar.
            sol.click('nav [data-tab="aparelhos"]')
            sol.pg.wait_for_selector(f'.device-card[data-did="{dev_id}"]', timeout=15000)

            # Solicitante abre uma manutenção → aparelho fica Inoperante (RLS permite por ter tarefa vinculada).
            sol.click("#nfab")
            sol.pg.select_option("#f_v", dev_id)
            sol.wait()
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

            # Notificação chega ao solicitante em tempo real.
            sol.pg.wait_for_function("state.notifs.some(n => /aceita/.test(n.txt))", timeout=15000)

            # Segurança (RLS): o solicitante não altera o perfil do funcionário, não lê notificações
            # alheias e não apaga o aparelho; o funcionário não cria tarefa em nome de outro.
            r = sol.db_call(f"await db.doc('profiles/{func_id}').update({{ name: 'Hacker' }})")
            assert r.startswith("erro"), r
            sol.db_call(f"await db.doc('devices/{dev_id}').delete()")  # RLS: apaga 0 linhas
            func.wait(2000)
            assert func.pg.evaluate(f"!!state.devices['{dev_id}']"), "aparelho não deveria ser apagado"
            r = func.db_call(f"await db.collection('tasks').doc().set({{ title: 'x', req: '{sol_id}', emp: '{func_id}' }})")
            assert r.startswith("erro"), r
            leaked = sol.pg.evaluate(f"""async () => {{
              const db = await claude.use('db');
              return await new Promise((ok) => {{
                const off = db.collection('notifs').onSnapshot((s) => {{ off(); ok(s.docs.filter((d) => d.data().to !== '{sol_id}').length); }});
              }});
            }}""")
            assert leaked == 0, leaked

            # Persistência: recarregar mantém a sessão e os dados vêm do banco.
            func.pg.reload()
            func.pg.wait_for_selector("nav button", timeout=20000)
            assert func.pg.evaluate(f"!!state.tasks['{tid}']")

            # Sair encerra a sessão.
            func.click("#mnb")
            func.click("#a_out")
            func.pg.wait_for_selector("#a_go", timeout=10000)

            errors = func.errors + sol.errors
            assert not errors, errors
            print("OK: Supabase — cadastro, tempo real entre dois navegadores, RLS e persistência.")
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
