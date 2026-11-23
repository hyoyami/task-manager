"""Relatórios do TASK MANAGER em Markdown (saída padrão) — ponto de entrada único.

Uso:
  python3 scripts/relatorio.py TIPO PERIODO [--empresa NOME_OU_ID]
  python3 scripts/relatorio.py empresas                 lista as empresas do banco
  python3 scripts/relatorio.py limpar                   apaga de relatorios/ o que tiver mais de 7 dias
                                                        (isso também acontece sozinho a cada relatório gerado)

  TIPO     commits | usuarios | tarefas | aparelhos | jornada
  PERIODO  dia | semana | mes  [AAAA-MM-DD de referência]   ou   AAAA-MM-DD AAAA-MM-DD (intervalo, datas inclusivas)

  commits    histórico do git (scripts/relatorio-commits.sh)
  usuarios   funcionários (desempenho) e solicitantes (pedidos), separados, com detalhe por pessoa
  tarefas    tarefas e produtividade da empresa (criadas, concluídas, por funcionário/solicitante/urgência, abertas)
  aparelhos  aparelhos e manutenção (status, manutenções, tempo parado, problemas, periódicas)
  jornada    horas extras, ausências, intervalos e folgas por funcionário

Os relatórios da empresa leem o Supabase (somente leitura) pela API de gerenciamento, com o token em
~/.supabase-token. O agente "relatorios" (.claude/agents/relatorios.md) acrescenta o resumo e gera o PDF.
"""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROJECT_REF = "fguabpdfmqjcmvrpdicg"
TZ = ZoneInfo("America/Sao_Paulo")
MIN = 60_000
DIAS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
PRIO = {"alta": "Alta", "neutra": "Neutra", "baixa": "Baixa"}
STATUS = {"aguardando": "Aguardando aceite", "pendente": "Pendente", "agendada": "Agendada", "andamento": "Em andamento",
          "pausada": "Pausada", "concluida": "Concluída", "cancelada": "Cancelada", "programada": "Programada"}
OPEN = ["aguardando", "pendente", "agendada", "andamento", "pausada"]
DOWN = ("Inoperante", "Em manutenção")


# ---------- Período ----------
def period(args):
    """(início, fim inclusivo, título, rótulo curto) a partir de dia|semana|mes [ref] ou AAAA-MM-DD AAAA-MM-DD."""
    kind = args[0] if args else ""
    ref = date.fromisoformat(args[1]) if len(args) > 1 and kind in ("dia", "semana", "mes") else date.today()
    if kind == "dia":
        return ref, ref, f"Dia {ref:%d/%m/%Y}"
    if kind == "semana":
        s = ref - timedelta(days=ref.weekday())
        e = s + timedelta(days=6)
        return s, e, f"Semana de {s:%d/%m} a {e:%d/%m/%Y}"
    if kind == "mes":
        s = ref.replace(day=1)
        e = (s.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        return s, e, f"Mês {s:%m/%Y}"
    if re.fullmatch(r"\d{4}-\d\d-\d\d", kind) and len(args) > 1:
        s, e = date.fromisoformat(kind), date.fromisoformat(args[1])
        return s, e, f"De {s:%d/%m/%Y} a {e:%d/%m/%Y}"
    sys.exit("Período inválido. Use: dia|semana|mes [AAAA-MM-DD]  ou  AAAA-MM-DD AAAA-MM-DD")


def ms_of(d, end=False):
    dt = datetime(d.year, d.month, d.day, tzinfo=TZ) + (timedelta(days=1) if end else timedelta())
    return int(dt.timestamp() * 1000)


def dt(ms):
    return datetime.fromtimestamp(ms / 1000, TZ)


def fdate(ms):
    return f"{dt(ms):%d/%m/%Y}"


def fdt(ms):
    return f"{dt(ms):%d/%m %H:%M}"


def hm(minutes):
    minutes = int(round(minutes or 0))
    h, m = divmod(minutes, 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def cell(s):
    return str(s if s not in (None, "") else "—").replace("|", "\\|").replace("\n", " ")


def table(head, rows, right=()):
    out = ["| " + " | ".join(head) + " |",
           "|" + "|".join("---:" if i in right else "---" for i in range(len(head))) + "|"]
    out += ["| " + " | ".join(cell(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


# ---------- Supabase (somente leitura) ----------
def sql(query):
    token = (pathlib.Path.home() / ".supabase-token").read_text().strip()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "task-manager-relatorios"},
        method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"[]")


def companies():
    return sql("select id, data->>'name' as name from public.companies order by data->>'name'")


def pick_company(wanted):
    lista = companies()
    if wanted:
        w = wanted.strip().lower()
        hit = [c for c in lista if c["id"] == wanted or c["name"].lower() == w] or [c for c in lista if w in c["name"].lower()]
        if len(hit) == 1:
            return hit[0]
        sys.exit("Empresa não encontrada ou ambígua: " + wanted + ". Empresas: " + ", ".join(c["name"] for c in lista))
    if len(lista) == 1:
        return lista[0]
    sys.exit("Informe a empresa com --empresa. Empresas: " + ", ".join(c["name"] for c in lista))


def load(cid):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", cid):
        sys.exit("Id de empresa inválido.")
    rows = lambda tbl: {r["id"]: r["data"] for r in sql(f"select id, data from public.{tbl} where company = '{cid}'")}
    comp = sql(f"select data from public.companies where id = '{cid}'")[0]["data"]
    return comp, rows("profiles"), rows("tasks"), rows("devices")


# ---------- Regras (iguais às do app) ----------
def finished_at(t):
    for h in reversed(t.get("hist") or []):
        if re.search(r"Conclu|Cancel|Recus", h.get("x", "")):
            return h["t"]
    return t.get("created")


def executes(p):
    return p.get("role") in ("func", "admin")


def header(kind, titulo, comp):
    return (f"# Relatório de {kind} — {titulo}\n\n"
            f"_Empresa `{comp.get('name', '—')}` · gerado em {datetime.now(TZ):%d/%m/%Y %H:%M}_\n")


OT_RE = re.compile(r"hora extra: (\d+) min")


def overtime_by_emp(tasks, s_ms, e_ms):
    """Hora extra registrada no período, por funcionário, pelo histórico ("… · hora extra: N min") —
    conta também a de tarefas ainda abertas (pausadas)."""
    out = defaultdict(int)
    for t in tasks.values():
        for h in t.get("hist") or []:
            m = OT_RE.search(h.get("x", ""))
            if m and s_ms <= h["t"] < e_ms:
                out[t.get("emp")] += int(m[1])
    return out


def task_kind(t):
    """O "tipo" da tarefa para agrupar: o problema escolhido, ou o título sem o prefixo "Manutenção: "."""
    return t.get("preset") or re.sub(r"^Manutenção: ", "", t.get("title") or "—")


# ---------- Tarefas e produtividade ----------
def report_tasks(comp, people, tasks, devices, s_ms, e_ms, titulo):
    name = lambda uid: (people.get(uid) or {}).get("name") or ("—" if not uid else "(ex-membro)")
    inp = lambda ms: ms is not None and s_ms <= ms < e_ms
    created = [t for t in tasks.values() if inp(t.get("created"))]
    done = [t for t in tasks.values() if t.get("status") == "concluida" and inp(finished_at(t))]
    canceled = [t for t in tasks.values() if t.get("status") == "cancelada" and inp(finished_at(t))]
    open_now = [t for t in tasks.values() if t.get("status") in OPEN]
    worked = sum(t.get("dur") or 0 for t in done)
    lead = [(finished_at(t) - t["created"]) / MIN for t in done if t.get("created")]
    ot_emp = overtime_by_emp(tasks, s_ms, e_ms)

    out = [header("tarefas", titulo, comp), "## Números", "",
           table(["Criadas", "Concluídas", "Canceladas", "Abertas agora", "Tempo trabalhado", "Atendimento médio"],
                 [[len(created), len(done), len(canceled), len(open_now), hm(worked),
                   hm(sum(lead) / len(lead)) if lead else "—"]]), ""]

    # Por funcionário
    rows = []
    for uid, p in sorted(people.items(), key=lambda kv: kv[1].get("name", "")):
        if not executes(p):
            continue
        mine_done = [t for t in done if t.get("emp") == uid]
        rows.append([p.get("name"), len(mine_done), hm(sum(t.get("dur") or 0 for t in mine_done)),
                     hm(ot_emp[uid]) if ot_emp[uid] else "—",
                     len([t for t in canceled if t.get("emp") == uid]),
                     len([t for t in open_now if t.get("emp") == uid])])
    out += ["## Por funcionário", "", table(["Funcionário", "Concluídas", "Tempo trabalhado", "Hora extra", "Canceladas", "Em aberto"],
                                             rows, right=(1, 2, 3, 4, 5)), ""]

    # Por solicitante
    reqs = sorted({t.get("req") for t in created + done + open_now if t.get("req")}, key=name)
    out += ["## Por solicitante", "", table(["Solicitante", "Pediu no período", "Concluídas", "Abertas agora"], [
        [name(u), len([t for t in created if t.get("req") == u]), len([t for t in done if t.get("req") == u]),
         len([t for t in open_now if t.get("req") == u])] for u in reqs], right=(1, 2, 3)), ""]

    # Por urgência
    def lead_of(lst):
        v = [(finished_at(t) - t["created"]) / MIN for t in lst if t.get("created")]
        return hm(sum(v) / len(v)) if v else "—"
    out += ["## Por urgência", "", table(["Urgência", "Criadas", "Concluídas", "Atendimento médio", "Abertas agora"], [
        [PRIO[k], len([t for t in created if t.get("prio") == k]), len([t for t in done if t.get("prio") == k]),
         lead_of([t for t in done if t.get("prio") == k]), len([t for t in open_now if t.get("prio") == k])]
        for k in PRIO], right=(1, 2, 3, 4)), ""]

    # Abertas agora (mais antigas primeiro)
    now = datetime.now(TZ).timestamp() * 1000
    rows = []
    for t in sorted(open_now, key=lambda t: t.get("created") or 0):
        idade = (now - (t.get("created") or now)) / MIN / 60 / 24
        dev = (devices.get(t.get("dev")) or {}).get("name") or t.get("devName")
        rows.append([t.get("title"), STATUS.get(t.get("status")), PRIO.get(t.get("prio")),
                     name(t.get("emp")) if t.get("emp") else "Sem usuário vinculado", name(t.get("req")),
                     dev or "—", fdt(t["start"]) if t.get("start") else "—",
                     f"{idade:.0f} dia(s)" if idade >= 1 else "hoje"])
    out += ["## Abertas agora", "", table(["Tarefa", "Status", "Urgência", "Responsável", "Solicitante", "Aparelho", "Horário", "Aberta há"], rows)
            if rows else "Nenhuma tarefa em aberto.", ""]

    # Concluídas no período
    rows = [[fdt(finished_at(t)), t.get("title"), name(t.get("emp")), hm(t.get("dur")),
             (devices.get(t.get("dev")) or {}).get("name") or t.get("devName") or "—",
             (t.get("summary") or "")[:90]] for t in sorted(done, key=finished_at)]
    out += ["## Concluídas no período", "", table(["Concluída em", "Tarefa", "Funcionário", "Duração", "Aparelho", "Relato"], rows)
            if rows else "Nenhuma tarefa concluída no período.", ""]
    if canceled:
        rows = [[fdt(finished_at(t)), t.get("title"), name(t.get("req")), name(t.get("emp")) if t.get("emp") else "—"]
                for t in sorted(canceled, key=finished_at)]
        out += ["## Canceladas ou recusadas no período", "", table(["Em", "Tarefa", "Solicitante", "Responsável"], rows), ""]
    return "\n".join(out)


# ---------- Aparelhos e manutenção ----------
STATUS_RE = re.compile(r"^Status: (.+?) → (.+?)(?: \(|$)")


def down_minutes(d, s_ms, e_ms, now_ms):
    """Minutos que o aparelho ficou Inoperante/Em manutenção dentro de [s_ms, e_ms), pelo log de status."""
    changes = [(h["t"], m[1], m[2]) for h in (d.get("log") or []) if (m := STATUS_RE.match(h.get("x", "")))]
    changes.sort()
    status = changes[0][1] if changes else (d.get("status") or "Operacional")
    cursor = d.get("created") or s_ms
    total = 0
    for t, _old, new in changes + [(min(now_ms, e_ms), None, None)]:
        a, b = max(cursor, s_ms), min(t, e_ms)
        if status in DOWN and b > a:
            total += b - a
        cursor, status = t, (new or status)
    return total / MIN


def add_interval(ms, rec):
    d0 = dt(ms).date()
    n, u = rec["n"], rec["u"]
    if u == "d":
        return d0 + timedelta(days=n)
    y, m = (d0.year + n, d0.month) if u == "y" else (d0.year + (d0.month - 1 + n) // 12, (d0.month - 1 + n) % 12 + 1)
    last = ((date(y, m, 28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
    return date(y, m, min(d0.day, last))


def report_devices(comp, people, tasks, devices, s_ms, e_ms, titulo):
    name = lambda uid: (people.get(uid) or {}).get("name") or "—"
    now_ms = int(datetime.now(TZ).timestamp() * 1000)
    inp = lambda ms: ms is not None and s_ms <= ms < e_ms
    dev_tasks = [t for t in tasks.values() if t.get("dev")]
    done = [t for t in dev_tasks if t.get("status") == "concluida" and inp(finished_at(t))]
    opened = [t for t in dev_tasks if inp(t.get("created"))]
    st = Counter(d.get("status") or "Operacional" for d in devices.values())
    down = {i: down_minutes(d, s_ms, e_ms, now_ms) for i, d in devices.items()}

    out = [header("aparelhos e manutenção", titulo, comp), "## Números", "",
           table(["Aparelhos", "Operacionais", "Inoperantes", "Em manutenção", "Manutenções concluídas", "Tempo parado (corrido)"],
                 [[len(devices), st["Operacional"], st["Inoperante"], st["Em manutenção"], len(done), hm(sum(down.values()))]]), ""]

    cats = sorted({d.get("area") or "—" for d in devices.values()})
    out += ["## Status atual por categoria", "", table(["Categoria", "Aparelhos", "Operacional", "Inoperante", "Em manutenção", "Fora de uso"], [
        [c] + [len([d for d in devices.values() if (d.get("area") or "—") == c])]
        + [len([d for d in devices.values() if (d.get("area") or "—") == c and (d.get("status") or "Operacional") == s])
           for s in ("Operacional", "Inoperante", "Em manutenção", "Fora de uso")] for c in cats], right=(1, 2, 3, 4, 5)), ""]

    rows = []
    for i, d in sorted(devices.items(), key=lambda kv: (-down[kv[0]], kv[1].get("name", ""))):
        n_open = len([t for t in opened if t.get("dev") == i])
        n_done = len([t for t in done if t.get("dev") == i])
        if n_open or n_done or down[i] or (d.get("status") or "Operacional") != "Operacional":
            rows.append([d.get("name"), d.get("area"), d.get("status") or "Operacional", n_open, n_done, hm(down[i]) if down[i] else "—"])
    out += ["## Aparelhos com ocorrências no período", "", table(
        ["Aparelho", "Categoria", "Status atual", "Chamados abertos", "Manutenções concluídas", "Tempo parado (corrido)"], rows, right=(3, 4, 5))
        if rows else "Nenhuma ocorrência com aparelhos no período.", ""]

    probs = Counter(t.get("preset") or "Outros (descrito)" for t in opened)
    if probs:
        out += ["## Problemas mais frequentes", "", table(["Problema", "Chamados no período"], probs.most_common(10), right=(1,)), ""]

    rows = [[fdt(finished_at(t)), (devices.get(t["dev"]) or {}).get("name") or t.get("devName"), t.get("preset") or t.get("title"),
             name(t.get("emp")), hm(t.get("dur")), (t.get("summary") or "")[:90]] for t in sorted(done, key=finished_at)]
    out += ["## Manutenções concluídas", "", table(["Concluída em", "Aparelho", "Problema", "Funcionário", "Duração", "Relato"], rows)
            if rows else "Nenhuma manutenção concluída no período.", ""]

    # Manutenções periódicas: programadas e avisos vencendo (mesma regra do alerta da Área de Trabalho).
    rows = []
    for t in sorted([t for t in dev_tasks if t.get("status") == "programada"], key=lambda t: t.get("want") or 0):
        rows.append([(devices.get(t["dev"]) or {}).get("name") or t.get("devName"), t.get("preset") or t.get("title"),
                     "Programada", fdate(t["want"]) if t.get("want") else "—"])
    prob_rec = comp.get("probRec") or {}
    today = datetime.now(TZ).date()
    for i, d in devices.items():
        for prob, rec in (prob_rec.get(d.get("area")) or {}).items():
            rel = [t for t in dev_tasks if t.get("dev") == i and t.get("preset") == prob]
            if any(t.get("status") not in ("concluida", "cancelada") for t in rel):
                continue
            last = max([finished_at(t) for t in rel if t.get("status") == "concluida"] or [d.get("created") or now_ms])
            due = add_interval(last, rec)
            if (due - today).days <= 30:
                rows.append([d.get("name"), prob, "Atrasada" if due < today else "Vence em breve", f"{due:%d/%m/%Y}"])
    if rows:
        out += ["## Manutenções periódicas", "", table(["Aparelho", "Problema", "Situação", "Data"], rows), ""]

    notes = sorted([(h["t"], d.get("name"), h["x"]) for d in devices.values() for h in (d.get("log") or [])
                    if h.get("x", "").startswith("Anotação") and inp(h["t"])])
    if notes:
        out += ["## Anotações no log", "", table(["Em", "Aparelho", "Anotação"], [[fdt(t), n, x] for t, n, x in notes]), ""]
    return "\n".join(out)


# ---------- Jornada: horas extras e ausências ----------
def overlap(a, b, s, e):
    return max(0, min(b, e) - max(a, s))


def report_journey(comp, people, tasks, devices, s_ms, e_ms, titulo):
    inp = lambda ms: ms is not None and s_ms <= ms < e_ms
    staff = sorted([(u, p) for u, p in people.items() if executes(p)], key=lambda kv: kv[1].get("name", ""))
    # Hora extra registrada nas tarefas (pelo histórico: "… · hora extra: N min").
    reg = defaultdict(int)
    reg_rows = []
    for t in tasks.values():
        for h in t.get("hist") or []:
            m = OT_RE.search(h.get("x", ""))
            if m and inp(h["t"]):
                reg[t.get("emp")] += int(m[1])
                reg_rows.append([fdt(h["t"]), (people.get(t.get("emp")) or {}).get("name"), t.get("title"), hm(int(m[1]))])
    hol = [x for y in ((comp.get("holidays") or {}).get("years") or {}).values() for x in y]
    hol_in = [x for x in hol if inp(ms_of(date.fromisoformat(x["d"])))]

    rows, extra_rows, abs_rows, off_rows = [], [], [], []
    tot_prog = tot_reg = 0
    for uid, p in staff:
        extras = [x for x in (p.get("extra") or []) if overlap(x["s"], x["e"], s_ms, e_ms)]
        prog = sum(overlap(x["s"], x["e"], s_ms, e_ms) for x in extras) / MIN
        offs = p.get("off") or []
        parts = [o for o in offs if o.get("part") and overlap(o["s"], o["e"], s_ms, e_ms)]
        breaks = [o for o in offs if o.get("brk") and overlap(o["s"], o["e"], s_ms, e_ms)]
        folgas = [o for o in offs if not o.get("part") and not o.get("brk") and overlap(o["s"], o["e"], s_ms, e_ms)]
        folga_dias = sum(round(overlap(o["s"], o["e"], s_ms, e_ms) / (24 * 60 * MIN)) or 1 for o in folgas)
        tot_prog += prog
        tot_reg += reg[uid]
        jornada = f"{p.get('start', '08:00')}–{p.get('end', '17:00')}" + (" · sem almoço fixo" if p.get("noBreak") else
                                                                         f" · almoço {p.get('bs', '12:00')}–{p.get('be', '13:00')}")
        rows.append([p.get("name"), jornada, hm(prog) if prog else "—", hm(reg[uid]) if reg[uid] else "—",
                     f"{len(parts)} ({hm(sum(overlap(o['s'], o['e'], s_ms, e_ms) for o in parts) / MIN)})" if parts else "—",
                     f"{len(breaks)} ({hm(sum(overlap(o['s'], o['e'], s_ms, e_ms) for o in breaks) / MIN)})" if breaks else "—",
                     folga_dias or "—"])
        extra_rows += [[fdate(x["s"]), p.get("name"), f"{dt(x['s']):%H:%M}–{dt(x['e']):%H:%M}", hm((x["e"] - x["s"]) / MIN), x.get("note") or "—"]
                       for x in extras]
        abs_rows += [[fdate(o["s"]), p.get("name"), "Ausência parcial" if o.get("part") else "Intervalo",
                      f"{dt(o['s']):%H:%M}–{dt(o['e']):%H:%M}", o.get("note") or "—"] for o in parts + breaks]
        off_rows += [[fdate(o["s"]), fdate(o["e"] - 1), p.get("name"), o.get("note") or "—"] for o in folgas]

    out = [header("jornada", titulo, comp), "## Números", "",
           table(["Funcionários", "Hora extra programada", "Hora extra registrada", "Ausências parciais", "Dias de folga/ausente", "Feriados no período"],
                 [[len(staff), hm(tot_prog), hm(tot_reg), len([r for r in abs_rows if r[2] == "Ausência parcial"]),
                   sum(r[6] for r in rows if r[6] != "—"), len([x for x in hol_in if x.get("t") != "F"])]]), "",
           "## Por funcionário", "",
           table(["Funcionário", "Jornada", "Hora extra programada", "Hora extra registrada", "Ausências parciais", "Intervalos", "Dias de folga"],
                 rows, right=(2, 3, 6)), ""]
    out += ["## Horas extras programadas", "", table(["Dia", "Funcionário", "Horário", "Duração", "Motivo"], sorted(extra_rows))
            if extra_rows else "Nenhuma hora extra programada no período.", ""]
    out += ["## Hora extra registrada nas tarefas", "", table(["Em", "Funcionário", "Tarefa", "Hora extra"], sorted(reg_rows))
            if reg_rows else "Nenhuma hora extra registrada em tarefas no período.", ""]
    out += ["## Ausências parciais e intervalos", "", table(["Dia", "Funcionário", "Tipo", "Horário", "Motivo"], sorted(abs_rows))
            if abs_rows else "Nenhuma ausência parcial ou intervalo no período.", ""]
    if off_rows:
        out += ["## Folgas e dias ausente", "", table(["De", "Até", "Funcionário", "Motivo"], sorted(off_rows)), ""]
    if hol_in:
        kinds = {"N": "Nacional", "E": "Estadual", "M": "Municipal", "F": "Ponto facultativo"}
        out += ["## Feriados no período", "", table(["Data", "Feriado", "Tipo"], [
            [f"{date.fromisoformat(x['d']):%d/%m/%Y}", x["n"] + (" (previsto)" if x.get("est") else ""), kinds.get(x.get("t"), "")]
            for x in sorted(hol_in, key=lambda x: x["d"])]), ""]
    return "\n".join(out)


# ---------- Usuários: funcionários e solicitantes, separados ----------
def leaders(counter, fmt=str, none="nenhum", fem=False):
    """Os mais frequentes, citando todos os empatados; avisa quando nada se repetiu."""
    if not counter:
        return none
    top = max(counter.values())
    keys = [fmt(k) for k, v in counter.items() if v == top]
    if top == 1 and len(counter) > 1:
        return f"{'nenhuma' if fem else 'nenhum'} se repetiu ({len(counter)} {'diferentes'}, 1× cada)"
    joined = keys[0] if len(keys) == 1 else ", ".join(keys[:-1]) + " e " + keys[-1]
    return f"{joined} ({top}×" + (" cada)" if len(keys) > 1 else ")")

ROLE = {"admin": "Administrador", "func": "Funcionário", "sol": "Solicitante"}


def report_users(comp, people, tasks, devices, s_ms, e_ms, titulo):
    name = lambda uid: (people.get(uid) or {}).get("name") or ("—" if not uid else "(ex-membro)")
    inp = lambda ms: ms is not None and s_ms <= ms < e_ms
    dev_of = lambda t: (devices.get(t.get("dev")) or {})
    dev_name = lambda t: dev_of(t).get("name") or t.get("devName")
    dev_area = lambda t: dev_of(t).get("area") or t.get("devArea")
    day_of = lambda ms: dt(ms).date()
    fday = lambda d: f"{DIAS[d.weekday()]}, {d:%d/%m/%Y}"
    all_t = list(tasks.values())
    done = [t for t in all_t if t.get("status") == "concluida" and inp(finished_at(t))]
    canceled = [t for t in all_t if t.get("status") == "cancelada" and inp(finished_at(t))]
    created = [t for t in all_t if inp(t.get("created"))]
    open_now = [t for t in all_t if t.get("status") in OPEN]
    ot_emp = overtime_by_emp(tasks, s_ms, e_ms)
    lead = lambda lst: [(finished_at(t) - t["created"]) / MIN for t in lst if t.get("created")]
    avg = lambda v: hm(sum(v) / len(v)) if v else "—"

    staff = sorted([(u, p) for u, p in people.items() if executes(p)], key=lambda kv: kv[1].get("name", ""))
    requesters = sorted({t.get("req") for t in created + done + canceled if t.get("req")}, key=name)

    out = [header("usuários", titulo, comp), "## Números", "",
           table(["Funcionários", "Solicitantes", "Tarefas concluídas", "Tempo trabalhado", "Hora extra", "Pedidos no período"],
                 [[len(staff), len(requesters), len(done), hm(sum(t.get("dur") or 0 for t in done)),
                   hm(sum(ot_emp.values())), len(created)]]), ""]

    # ===== Funcionários =====
    over, detail = [], []
    for uid, p in staff:
        mine = sorted([t for t in done if t.get("emp") == uid], key=finished_at)
        worked = sum(t.get("dur") or 0 for t in mine)
        recurring = [t for t in mine if t.get("rec") or t.get("series")]
        per_day = Counter(day_of(finished_at(t)) for t in mine)
        min_day = defaultdict(int)
        for t in mine:
            min_day[day_of(finished_at(t))] += t.get("dur") or 0
        best_n = max(per_day.items(), key=lambda kv: (kv[1], -kv[0].toordinal())) if per_day else None
        best_m = max(min_day.items(), key=lambda kv: (kv[1], -kv[0].toordinal())) if min_day else None
        kinds = Counter(task_kind(t) for t in mine)
        devs = Counter((dev_name(t), dev_area(t)) for t in mine if t.get("dev") or t.get("devName"))
        printers = Counter(n for (n, a) in devs.elements() if (a or "").lower() == "impressora")
        over.append([p.get("name"), ROLE.get(p.get("role")), len(mine), hm(worked), avg([t.get("dur") or 0 for t in mine]),
                     len(recurring), hm(ot_emp[uid]) if ot_emp[uid] else "—",
                     len([t for t in canceled if t.get("emp") == uid]), len([t for t in open_now if t.get("emp") == uid]),
                     f"{best_n[0]:%d/%m} ({best_n[1]})" if best_n else "—"])

        d = [f"## Funcionário — {p.get('name')}", "",
             f"_{ROLE.get(p.get('role'))} · jornada {p.get('start', '08:00')}–{p.get('end', '17:00')}_", ""]
        if not mine:
            d += ["Nenhuma tarefa concluída no período."
                  + (f" Em aberto agora: {len([t for t in open_now if t.get('emp') == uid])}." if any(t.get('emp') == uid for t in open_now) else ""), ""]
            detail += d
            continue
        d += [f"- **Tarefas concluídas:** {len(mine)} · tempo trabalhado {hm(worked)} · média de {avg([t.get('dur') or 0 for t in mine])} por tarefa",
              f"- **Tarefas recorrentes (manutenção periódica):** "
              + (f"sim — {len(recurring)}: " + "; ".join(f"{task_kind(t)} ({dev_name(t) or '—'})" for t in recurring) if recurring else "nenhuma no período"),
              f"- **Tarefa que mais executa:** " + leaders(kinds, none="—", fem=True),
              f"- **Aparelho mais atendido:** " + leaders(devs, fmt=lambda k: f"{k[0]} ({k[1]})"),
              f"- **Impressora mais levada para manutenção:** " + leaders(printers, none="nenhuma"),
              f"- **Recorde de tarefas concluídas num dia:** {best_n[1]} em {fday(best_n[0])}",
              f"- **Dia de maior desempenho (tempo trabalhado):** {fday(best_m[0])} — {hm(best_m[1])}",
              f"- **Urgências atendidas:** " + ", ".join(f"{PRIO[k]} {len([t for t in mine if t.get('prio') == k])}" for k in PRIO),
              f"- **Tempo médio de atendimento** (pedido → concluída): {avg(lead(mine))}"
              + (f" · **hora extra:** {hm(ot_emp[uid])}" if ot_emp[uid] else ""), ""]
        d += ["### Tarefas que mais executa", "", table(["Tarefa / problema", "Vezes"], kinds.most_common(8), right=(1,)), ""]
        if devs:
            d += ["### Aparelhos mais atendidos", "", table(["Aparelho", "Categoria", "Manutenções"],
                                                          [[n, a, c] for (n, a), c in devs.most_common(8)], right=(2,)), ""]
        d += ["### Concluídas por dia", "", table(["Dia", "Concluídas", "Tempo trabalhado"],
                                                  [[fday(k), per_day[k], hm(min_day[k])] for k in sorted(per_day)], right=(1, 2)), ""]
        detail += d
    out += ["## Funcionários — visão geral", "", table(
        ["Funcionário", "Papel", "Concluídas", "Tempo trabalhado", "Média por tarefa", "Recorrentes", "Hora extra", "Canceladas", "Em aberto", "Recorde do dia"],
        over, right=(2, 3, 4, 5, 6, 7, 8)), ""] + detail

    # ===== Solicitantes =====
    over, detail = [], []
    for uid in requesters:
        asked = [t for t in created if t.get("req") == uid]
        got = [t for t in done if t.get("req") == uid]
        canc = [t for t in canceled if t.get("req") == uid]
        opn = [t for t in open_now if t.get("req") == uid]
        role = ROLE.get((people.get(uid) or {}).get("role"), "—")
        over.append([name(uid), role, len(asked), len(got), len(canc), len(opn), avg(lead(got))])
        d = [f"## Solicitante — {name(uid)}", "", f"_{role}_", ""]
        if not (asked or got or canc):
            detail += d + ["Nenhum pedido no período.", ""]
            continue
        prio = Counter(t.get("prio") for t in asked)
        devs = Counter(dev_name(t) for t in asked if t.get("dev") or t.get("devName"))
        kinds = Counter(task_kind(t) for t in asked)
        execs = Counter(name(t.get("emp")) for t in got)
        d += [f"- **Pedidos no período:** {len(asked)} · concluídos {len(got)} · cancelados {len(canc)} · abertos agora {len(opn)}",
              f"- **Urgência dos pedidos:** " + ", ".join(f"{PRIO[k]} {prio.get(k, 0)}" for k in PRIO),
              f"- **Tempo médio até a conclusão:** {avg(lead(got))}",
              f"- **Aparelho mais pedido:** " + leaders(devs),
              f"- **Problema mais pedido:** " + leaders(kinds, none="—"),
              f"- **Quem mais atendeu:** " + (", ".join(f"{n} ({c})" for n, c in execs.most_common(3)) if execs else "—"), ""]
        if opn:
            d += ["### Pedidos em aberto", "", table(["Tarefa", "Status", "Urgência", "Responsável", "Aberto em"], [
                [t.get("title"), STATUS.get(t.get("status")), PRIO.get(t.get("prio")),
                 name(t.get("emp")) if t.get("emp") else "Sem usuário vinculado", fdate(t["created"])] for t in opn]), ""]
        detail += d
    out += ["## Solicitantes — visão geral", "", table(
        ["Solicitante", "Papel", "Pedidos", "Concluídos", "Cancelados", "Abertos agora", "Tempo até concluir"],
        over, right=(2, 3, 4, 5, 6)) if over else "Nenhum pedido no período.", ""] + detail

    # Gráfico (o PDF desenha barras agrupadas a partir desta tabela; no .md fica a tabela).
    users = sorted({u for u, _ in staff} | set(requesters), key=name)
    rows = [[name(u), len([t for t in created if t.get("req") == u]), len([t for t in done if t.get("req") == u]),
             len([t for t in done if t.get("emp") == u])] for u in users]
    rows = [r for r in rows if any(r[1:])]
    if rows:
        out += ["## Gráfico — tarefas por usuário", "",
                "Solicitadas = pedidas no período · Concluídas dos pedidos = pedidos dele concluídos no período · "
                "Realizadas = concluídas por ele como funcionário.", "",
                table(["Usuário", "Solicitadas", "Concluídas dos pedidos", "Realizadas"], rows, right=(1, 2, 3)), ""]
    return "\n".join(out)


# ---------- Limpeza: relatórios ficam só 7 dias ----------
REPORTS_DIR = ROOT / "relatorios"
KEEP_DAYS = 7


def clean_old_reports(days=KEEP_DAYS):
    """Apaga de relatorios/ os .md e .pdf criados há mais de `days` dias (só essa pasta, só esses tipos)."""
    if not REPORTS_DIR.is_dir():
        return []
    limit = datetime.now().timestamp() - days * 86400
    removed = []
    # O .md e o .pdf de um relatório saem juntos; a idade conta pelo .md (quando o relatório foi criado).
    stems = {f.stem for f in REPORTS_DIR.iterdir() if f.is_file() and f.suffix in (".md", ".pdf")}
    for stem in sorted(stems):
        md, pdf = REPORTS_DIR / (stem + ".md"), REPORTS_DIR / (stem + ".pdf")
        born = (md if md.exists() else pdf).stat().st_mtime
        if born < limit:
            for f in (md, pdf):
                if f.exists():
                    f.unlink()
                    removed.append(f.name)
    return removed


REPORTS = {"usuarios": report_users, "tarefas": report_tasks, "aparelhos": report_devices, "jornada": report_journey}


def main():
    ap = argparse.ArgumentParser(description="Relatórios do TASK MANAGER (Markdown na saída padrão).")
    ap.add_argument("tipo", choices=["commits", "empresas", "limpar", *REPORTS])
    ap.add_argument("periodo", nargs="*")
    ap.add_argument("--empresa")
    a = ap.parse_args()
    removed = clean_old_reports()
    if removed or a.tipo == "limpar":
        print(f"Relatórios com mais de {KEEP_DAYS} dias apagados: " + (", ".join(removed) or "nenhum"), file=sys.stderr)
    if a.tipo == "limpar":
        return
    if a.tipo == "empresas":
        for c in companies():
            print(f"{c['id']}\t{c['name']}")
        return
    if a.tipo == "commits":
        sys.exit(subprocess.call([str(ROOT / "scripts" / "relatorio-commits.sh"), *a.periodo]))
    s, e, titulo = period(a.periodo)
    comp_ref = pick_company(a.empresa)
    comp, people, tasks, devices = load(comp_ref["id"])
    print(REPORTS[a.tipo](comp, people, tasks, devices, ms_of(s), ms_of(e, end=True),
                          titulo + f" ({s:%d/%m/%Y} a {e:%d/%m/%Y})" if a.periodo[0] in ("semana", "mes") else titulo))


if __name__ == "__main__":
    main()
