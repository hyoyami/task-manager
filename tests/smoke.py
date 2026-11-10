"""Teste de fumaca: cadastro + login usando o banco local (local-runtime.js).
Requer:  pip install playwright && playwright install chromium
Uso:     python tests/smoke.py
"""
import pathlib
from playwright.sync_api import sync_playwright

INDEX = (pathlib.Path(__file__).resolve().parent.parent / "index.html").as_uri()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 420, "height": 800})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(INDEX)
    pg.wait_for_selector("#a_go")
    pg.click("#a_mode")
    pg.fill("#a_n", "Ana")
    pg.fill("#a_e", "ana@teste.com")
    pg.fill("#a_p", "123456")
    pg.select_option("#a_r", "func")
    pg.click("#a_go")
    pg.wait_for_selector("nav button")
    tabs = pg.eval_on_selector_all("nav button", "e => e.map(x => x.textContent)")
    assert tabs == ["Agenda", "Tarefas", "Workstation"], tabs
    assert not errors, errors
    print("OK:", tabs)
    b.close()
