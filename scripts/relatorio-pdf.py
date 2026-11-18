"""Transforma o relatório de commits (.md gerado por scripts/relatorio-commits.sh + resumo) num PDF diagramado.

Uso:   .venv/bin/python scripts/relatorio-pdf.py relatorios/commits-dia-2026-11-18.md   (gera o .pdf ao lado)
Requer: Playwright com Chromium (o mesmo dos testes):
        python3 -m venv .venv && .venv/bin/pip install playwright && .venv/bin/playwright install chromium

Visual: o sistema "A Prancheta de Turno" (DESIGN.md) — monocromático, Carvão como acento, cor só para dados
(linhas adicionadas em verde, removidas em vermelho).
"""
import html
import pathlib
import re
import sys

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("Playwright não encontrado. Rode: python3 -m venv .venv && .venv/bin/pip install playwright "
             "&& .venv/bin/playwright install chromium — e use .venv/bin/python para este script.")


# ---------- Leitura do Markdown do relatório ----------
def inline(text):
    """**negrito**, `código` e escape de HTML."""
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    return out


def parse(md):
    rep = {"title": "", "meta": "", "sections": {}, "order": []}
    current = None
    for line in md.splitlines():
        if line.startswith("# "):
            rep["title"] = line[2:].split("—", 1)[-1].strip()
        elif line.startswith("## "):
            current = line[3:].strip()
            rep["sections"][current] = []
            rep["order"].append(current)
        elif current is None and line.startswith("_") and line.endswith("_"):
            rep["meta"] = line.strip("_")
        elif current is not None:
            rep["sections"][current].append(line)
        elif line.strip():
            rep.setdefault("intro", []).append(line)
    return rep


def table(lines):
    rows = [l for l in lines if l.startswith("|")]
    cells = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
    return cells[0], [c for c in cells[2:]] if len(cells) > 2 else []


def bullets(lines):
    """Tópicos de 1º nível com sub-tópicos: [(texto, [sub, …])]."""
    items = []
    for l in lines:
        if l.startswith("- "):
            items.append([l[2:], []])
        elif l.startswith("  - ") and items:
            items[-1][1].append(l[4:])
    return items


def commits_by_day(lines):
    days, day = [], None
    for l in lines:
        if l.startswith("### "):
            day = {"name": l[4:], "commits": []}
            days.append(day)
        elif l.startswith("- ") and day is not None:
            m = re.match(r"- \*\*(\d\d:\d\d)\*\* · `([0-9a-f]+)` · (.+?) — (.*)$", l)
            if m:
                day["commits"].append({"time": m[1], "hash": m[2], "author": m[3], "subject": m[4], "items": []})
        elif l.startswith("  - ") and day and day["commits"]:
            day["commits"][-1]["items"].append(l[4:])
    return days


# ---------- HTML ----------
CSS = """
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
:root { --papel:#f1f1f1; --folha:#fff; --tinta:#161616; --lapis:#6a6a6a; --risco:#dedede; --carvao:#262626;
        --suave:#ececec; --lacuna:#f6f6f6; --mais:#2f9e6b; --menos:#dc2626; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10.5pt/1.5 "Inter", "Segoe UI", "Helvetica Neue", "DejaVu Sans", Arial, sans-serif; color: var(--tinta); }
.brand { font-size: 8pt; font-weight: 800; letter-spacing: .32em; text-transform: uppercase; color: var(--lapis); }
.cover { background: var(--carvao); color: #fff; border-radius: 14px; padding: 22px 24px 20px; margin-bottom: 16px; }
.cover .brand { color: #bdbdbd; }
.cover h1 { margin: 6px 0 4px; font-size: 24pt; line-height: 1.15; letter-spacing: -.01em; }
.cover .meta { color: #cfcfcf; font-size: 9pt; }
.cover code { background: rgba(255, 255, 255, .14); color: #fff; }
.kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 0 0 18px; }
.kpi { border: 1px solid var(--risco); border-radius: 10px; padding: 10px 12px; background: var(--folha); }
.kpi b { display: block; font-size: 18pt; line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi span { font-size: 8pt; color: var(--lapis); text-transform: uppercase; letter-spacing: .06em; }
.kpi.mais b { color: var(--mais); } .kpi.menos b { color: var(--menos); }
h2 { font-size: 12pt; margin: 18px 0 8px; padding-bottom: 5px; border-bottom: 2px solid var(--carvao);
     text-transform: uppercase; letter-spacing: .08em; break-after: avoid; }
.summary { list-style: none; padding: 0; margin: 0; }
.summary li { padding: 8px 12px; margin: 0 0 6px; background: var(--lacuna); border-left: 3px solid var(--carvao);
              border-radius: 0 8px 8px 0; break-inside: avoid; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; break-inside: avoid; }
th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: var(--lapis);
     border-bottom: 1px solid var(--risco); padding: 5px 8px; }
td { padding: 6px 8px; border-bottom: 1px solid var(--suave); vertical-align: middle; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.two { display: grid; grid-template-columns: 1fr 2fr; gap: 16px; }
.bar { height: 7px; border-radius: 4px; background: var(--suave); overflow: hidden; display: flex; min-width: 90px; }
.bar i { display: block; height: 100%; } .bar .a { background: var(--mais); } .bar .d { background: var(--menos); }
.mais { color: var(--mais); } .menos { color: var(--menos); }
code { font: 8.5pt "DejaVu Sans Mono", Menlo, Consolas, monospace; background: var(--suave); padding: 1px 5px; border-radius: 4px; }
.day { margin: 12px 0 4px; font-weight: 700; font-size: 10.5pt; break-after: avoid; }
.day small { color: var(--lapis); font-weight: 500; }
.commit { position: relative; margin: 0 0 8px 6px; padding: 2px 0 6px 18px; border-left: 2px solid var(--risco); break-inside: avoid; }
.commit::before { content: ""; position: absolute; left: -6px; top: 6px; width: 10px; height: 10px; border-radius: 50%;
                  background: var(--carvao); border: 2px solid #fff; }
.commit .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.commit .time { font-weight: 800; font-variant-numeric: tabular-nums; }
.commit .author { color: var(--lapis); font-size: 9pt; }
.commit .subject { font-weight: 700; margin-top: 1px; }
.commit ul { margin: 3px 0 0; padding-left: 16px; color: #3a3a3a; font-size: 9pt; }
.commit li { margin: 1px 0; }
.empty { padding: 18px; text-align: center; color: var(--lapis); border: 1px dashed var(--risco); border-radius: 10px; }
"""


def numbers_kpis(rep):
    head, rows = table(rep["sections"].get("Números", []))
    if not rows:
        return ""
    v = rows[0]
    tiles = [("Commits", v[0], ""), ("Dias com commits", v[1], ""), ("Arquivos", v[2], ""),
             ("Linhas adicionadas", v[3], "mais"), ("Linhas removidas", v[4], "menos")]
    return '<div class="kpis">' + "".join(
        f'<div class="kpi {c}"><b>{html.escape(n)}</b><span>{html.escape(t)}</span></div>' for t, n, c in tiles) + "</div>"


def authors_table(rep):
    _, rows = table(rep["sections"].get("Por autor", []))
    body = "".join(f"<tr><td>{inline(a)}</td><td class='n'>{inline(n)}</td></tr>" for a, n in rows)
    return f"<table><tr><th>Autor</th><th class='n'>Commits</th></tr>{body}</table>"


def areas_table(rep):
    _, rows = table(rep["sections"].get("Áreas do código mais alteradas", []))
    parsed = []
    for area, files, lines in rows:
        m = re.match(r"\+(\d+) / −(\d+)", lines)
        a, d = (int(m[1]), int(m[2])) if m else (0, 0)
        parsed.append((area, files, a, d))
    top = max([a + d for _, _, a, d in parsed] or [1])
    body = ""
    for area, files, a, d in parsed:
        wa, wd = 100 * a / top, 100 * d / top
        body += (f"<tr><td>{inline(area)}</td><td class='n'>{files}</td>"
                 f"<td><div class='bar'><i class='a' style='width:{wa:.1f}%'></i><i class='d' style='width:{wd:.1f}%'></i></div></td>"
                 f"<td class='n'><span class='mais'>+{a}</span> / <span class='menos'>−{d}</span></td></tr>")
    return ("<table><tr><th>Área</th><th class='n'>Arquivos</th><th>Volume</th><th class='n'>Linhas</th></tr>"
            f"{body}</table>")


def timeline(rep):
    out = ""
    for day in commits_by_day(rep["sections"].get("Commits por dia", [])):
        n = len(day["commits"])
        out += f'<div class="day">{inline(day["name"])} <small>· {n} commit{"s" if n != 1 else ""}</small></div>'
        for c in day["commits"]:
            items = "".join(f"<li>{inline(i)}</li>" for i in c["items"])
            out += (f'<div class="commit"><div class="head"><span class="time">{c["time"]}</span><code>{c["hash"]}</code>'
                    f'<span class="author">{inline(c["author"])}</span></div>'
                    f'<div class="subject">{inline(c["subject"])}</div>' + (f"<ul>{items}</ul>" if items else "") + "</div>")
    return out


def build_html(rep):
    title = html.escape(rep["title"] or "Relatório de commits")
    parts = [f'<div class="cover"><div class="brand">TASK MANAGER · Relatório de commits</div><h1>{title}</h1>'
             f'<div class="meta">{inline(rep["meta"])}</div></div>']
    if "Números" not in rep["sections"]:  # período sem commits
        resumo = [l for l in rep["sections"].get("Resumo", []) if l.strip()]
        text = " ".join(l.lstrip("- ") for l in resumo) or "Nenhum commit neste período."
        return parts[0] + f'<div class="empty">{inline(text)}</div>'
    parts.append(numbers_kpis(rep))
    summary = bullets(rep["sections"].get("Resumo", []))
    if summary:
        parts.append("<h2>Resumo</h2><ul class='summary'>" + "".join(f"<li>{inline(t)}</li>" for t, _ in summary) + "</ul>")
    parts.append("<h2>Equipe e áreas do código</h2><div class='two'><div>" + authors_table(rep) + "</div><div>"
                 + areas_table(rep) + "</div></div>")
    parts.append("<h2>Commits por dia</h2>" + timeline(rep))
    return "".join(parts)


def render_pdf(md_path, pdf_path=None):
    md_path = pathlib.Path(md_path)
    pdf_path = pathlib.Path(pdf_path) if pdf_path else md_path.with_suffix(".pdf")
    rep = parse(md_path.read_text(encoding="utf-8"))
    doc = (f"<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>{html.escape(rep['title'])}</title>"
           f"<style>{CSS}</style></head><body>{build_html(rep)}</body></html>")
    footer = ("<div style='width:100%;font:7.5pt Arial,sans-serif;color:#8a8a8a;padding:0 15mm;display:flex;"
              "justify-content:space-between'><span>TASK MANAGER · " + html.escape(rep["title"]) + "</span>"
              "<span>Página <span class='pageNumber'></span> de <span class='totalPages'></span></span></div>")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(doc, wait_until="load")
        page.pdf(path=str(pdf_path), format="A4", print_background=True, display_header_footer=True,
                 header_template="<span></span>", footer_template=footer,
                 margin={"top": "16mm", "bottom": "18mm", "left": "15mm", "right": "15mm"})
        browser.close()
    return pdf_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(render_pdf(*sys.argv[1:3]))
