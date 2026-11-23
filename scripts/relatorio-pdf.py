"""Transforma um relatório (.md gerado por scripts/relatorio.py ou relatorio-commits.sh + resumo) num PDF diagramado.

Funciona para qualquer tipo: capa, cartões com os "Números", "Resumo" em destaque e as demais seções (tabelas,
listas, subtítulos e parágrafos). O relatório de commits ganha ainda a barra de volume por área e a linha do tempo.

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
    out = re.sub(r"(?<![\w`])_(?!\s)(.+?)(?<!\s)_(?![\w`])", r"<em>\1</em>", out)
    return out


def parse(md):
    rep = {"title": "", "kind": "Relatório", "meta": "", "sections": {}, "order": []}
    current = None
    for line in md.splitlines():
        if line.startswith("# "):
            left, _, right = line[2:].partition("—")
            rep["title"] = (right or left).strip()
            rep["kind"] = left.strip() if right else "Relatório"
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
.kpis.small .kpi b { font-size: 12.5pt; white-space: nowrap; } .kpis.small .kpi { padding: 9px 10px; }
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
.chart-block { break-inside: avoid; }
.chart { border: 1px solid var(--risco); border-radius: 10px; padding: 10px 12px 4px; margin: 4px 0 6px; }
.chart-note { font-size: 8.5pt; color: var(--lapis); margin: 2px 0 6px; }
.chart-table table { font-size: 8.5pt; }
h3 { font-size: 10.5pt; margin: 12px 0 6px; break-after: avoid; }
p { margin: 4px 0 8px; }
ul.plain { margin: 4px 0 10px; padding-left: 18px; } ul.plain li { margin: 2px 0; }
.empty { padding: 18px; text-align: center; color: var(--lapis); border: 1px dashed var(--risco); border-radius: 10px; }
"""


def numbers_kpis(rep):
    head, rows = table(rep["sections"].get("Números", []))
    if not rows:
        return ""
    tone = lambda v: "mais" if v.startswith("+") else "menos" if v.startswith("−") else ""
    small = " small" if len(head) >= 6 else ""
    return f'<div class="kpis{small}" style="grid-template-columns:repeat({len(head)},1fr)">' + "".join(
        f'<div class="kpi {tone(v)}"><b>{inline(v)}</b><span>{html.escape(t)}</span></div>' for t, v in zip(head, rows[0])) + "</div>"


# ---------- Gráfico de barras agrupadas (seções "Gráfico — …") ----------
# Paleta categórica validada (ordem fixa): azul, laranja, verde-água. O verde-água fica abaixo de 3:1 no branco,
# por isso todo valor vai escrito na barra e a tabela com os mesmos números fica logo abaixo.
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]


def grouped_bars(head, rows):
    """SVG de colunas agrupadas: um grupo por linha (rótulo = 1ª coluna), uma série por coluna numérica."""
    names, series = head[1:], len(head) - 1
    vals = [[int(re.sub(r"\D", "", c) or 0) for c in r[1:]] for r in rows]
    top = max([v for r in vals for v in r] + [1])
    step = next(s for s in (1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000) if top / s <= 5)
    ymax = step * -(-top // step)
    W, H, L, R, T, B = 680, 300, 34, 8, 40, 46
    pw, ph = W - L - R, H - T - B
    band = pw / max(len(rows), 1)
    bw, gap = min(24, (band * 0.7 - (series - 1) * 2) / series), 2
    gw = series * bw + (series - 1) * gap
    y = lambda v: T + ph - v / ymax * ph
    svg = [f'<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Gráfico de colunas agrupadas: {html.escape(", ".join(names))} por usuário" '
           'style="font-family:inherit">']
    for k in range(0, ymax + 1, step):  # grade recessiva
        yy = y(k)
        svg.append(f'<line x1="{L}" x2="{W - R}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="#ececec" stroke-width="1"/>'
                   f'<text x="{L - 6}" y="{yy + 3:.1f}" text-anchor="end" font-size="9" fill="#8a8a8a">{k}</text>')
    svg.append(f'<line x1="{L}" x2="{W - R}" y1="{y(0):.1f}" y2="{y(0):.1f}" stroke="#bdbdbd" stroke-width="1"/>')
    for i, (r, v) in enumerate(zip(rows, vals)):
        x0 = L + i * band + (band - gw) / 2
        for j, val in enumerate(v):
            x = x0 + j * (bw + gap)
            h = y(0) - y(val)
            if val:  # coluna com topo arredondado (4px) e base reta
                rr = min(4, h, bw / 2)
                svg.append(f'<path d="M{x:.1f},{y(0):.1f} V{y(val) + rr:.1f} Q{x:.1f},{y(val):.1f} {x + rr:.1f},{y(val):.1f} '
                           f'H{x + bw - rr:.1f} Q{x + bw:.1f},{y(val):.1f} {x + bw:.1f},{y(val) + rr:.1f} V{y(0):.1f} Z" fill="{SERIES[j % len(SERIES)]}">'
                           f'<title>{html.escape(r[0])} — {html.escape(names[j])}: {val}</title></path>')
            svg.append(f'<text x="{x + bw / 2:.1f}" y="{y(val) - 4:.1f}" text-anchor="middle" font-size="9" font-weight="700" fill="#3a3a3a">{val}</text>')
        label = r[0] if len(r[0]) <= 22 else r[0][:21] + "…"
        svg.append(f'<text x="{L + i * band + band / 2:.1f}" y="{H - B + 16}" text-anchor="middle" font-size="10" fill="#161616">{html.escape(label)}</text>')
    lx = L  # legenda (sempre presente com 2+ séries), em uma linha acima do gráfico
    for j, n in enumerate(names):
        svg.append(f'<rect x="{lx}" y="12" width="10" height="10" rx="2" fill="{SERIES[j % len(SERIES)]}"/>'
                   f'<text x="{lx + 14}" y="21" font-size="10" fill="#3a3a3a">{html.escape(n)}</text>')
        lx += 14 + len(n) * 5.6 + 18
    svg.append("</svg>")
    return "<div class='chart'>" + "".join(svg) + "</div>"


def chart_section(lines):
    """Seção "Gráfico — …": legenda explicativa, o gráfico e a tabela (visão em tabela dos mesmos números)."""
    rows = [l for l in lines if l.startswith("|")]
    if len(rows) < 3:
        return generic_section(lines)
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], cells[2:]
    notes = [l for l in lines if l.strip() and not l.startswith("|")]
    return (grouped_bars(head, body) + "".join(f"<p class='chart-note'>{inline(n)}</p>" for n in notes)
            + "<div class='chart-table'>" + generic_section(rows) + "</div>")


def generic_section(lines):
    """Tabelas (alinhamento pela linha ---:), listas com sub-itens, ### subtítulos e parágrafos."""
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("|"):
            block = []
            while i < len(lines) and lines[i].startswith("|"):
                block.append(lines[i])
                i += 1
            cells = [[c.strip() for c in re.split(r"(?<!\\)\|", r.strip().strip("|"))] for r in block]
            head, sep, body = cells[0], cells[1] if len(cells) > 1 else [], cells[2:]
            right = [c.endswith(":") for c in sep] + [False] * len(head)
            cls = lambda k: " class='n'" if right[k] else ""
            out.append("<table><tr>" + "".join(f"<th{cls(k)}>{inline(h)}</th>" for k, h in enumerate(head)) + "</tr>"
                       + "".join("<tr>" + "".join(f"<td{cls(k)}>{inline(c.replace(chr(92) + '|', '|'))}</td>" for k, c in enumerate(r)) + "</tr>"
                                 for r in body) + "</table>")
            continue
        if line.startswith("- "):
            items = []
            while i < len(lines) and (lines[i].startswith("- ") or lines[i].startswith("  - ")):
                if lines[i].startswith("- "):
                    items.append([lines[i][2:], []])
                else:
                    items[-1][1].append(lines[i][4:])
                i += 1
            out.append("<ul class='plain'>" + "".join(
                f"<li>{inline(t)}" + (("<ul>" + "".join(f"<li>{inline(x)}</li>" for x in sub) + "</ul>") if sub else "") + "</li>"
                for t, sub in items) + "</ul>")
            continue
        if line.startswith("### "):
            out.append(f"<h3>{inline(line[4:])}</h3>")
        elif line.strip():
            out.append(f"<p>{inline(line)}</p>")
        i += 1
    return "".join(out)


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
    title = html.escape(rep["title"] or "Relatório")
    parts = [f'<div class="cover"><div class="brand">TASK MANAGER · {html.escape(rep["kind"])}</div><h1>{title}</h1>'
             f'<div class="meta">{inline(rep["meta"])}</div></div>']
    if "Números" not in rep["sections"]:  # período sem dados (ex.: nenhum commit)
        resumo = [l for l in rep["sections"].get("Resumo", []) if l.strip()]
        intro = [l for l in rep.get("intro", []) if l.strip()]
        text = " ".join(l.lstrip("- ") for l in resumo + intro) or "Nada neste período."
        return parts[0] + f'<div class="empty">{inline(text)}</div>'
    parts.append(numbers_kpis(rep))
    summary = bullets(rep["sections"].get("Resumo", []))
    if summary:
        parts.append("<h2>Resumo</h2><ul class='summary'>" + "".join(f"<li>{inline(t)}</li>" for t, _ in summary) + "</ul>")
    commits = "Commits por dia" in rep["sections"]
    for name in rep["order"]:
        if name in ("Números", "Resumo"):
            continue
        if commits and name == "Por autor":
            parts.append("<h2>Equipe e áreas do código</h2><div class='two'><div>" + authors_table(rep) + "</div><div>"
                         + areas_table(rep) + "</div></div>")
        elif commits and name == "Áreas do código mais alteradas":
            continue
        elif commits and name == "Commits por dia":
            parts.append("<h2>Commits por dia</h2>" + timeline(rep))
        elif name.startswith("Gráfico"):
            parts.append(f"<div class='chart-block'><h2>{inline(name)}</h2>" + chart_section(rep["sections"][name]) + "</div>")
        else:
            parts.append(f"<h2>{inline(name)}</h2>" + generic_section(rep["sections"][name]))
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
