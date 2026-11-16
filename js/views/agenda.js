/* ==========================================================================
   Aba Agenda de um funcionário: visões por dia, semana e mês, e ir para uma data.
   Agendar (arrastar/tocar num horário livre) só vale na semana corrente; o resto é visualização.
   O funcionário vê a própria agenda (e agenda arrastando cartões);
   o solicitante escolhe o funcionário e vê os horários dos outros como "Ocupado".
   ========================================================================== */
'use strict';

/** Blocos "livre" de 30 min clicáveis/arrastáveis dentro de um intervalo livre. */
function freeSlots(gap) {
  const earliest = Date.now() - SLOT_ROUND * MIN; // mesmo limite de fitsAt()
  let html = '';
  for (let t = gap.s; t < gap.e; t += SLOT_STEP * MIN) {
    if (t >= earliest) html += '<div class="card slot muted" data-t="' + t + '">' + fmtTime(t) + ' · livre</div>';
  }
  return html;
}

/**
 * Linha do tempo do dia: tarefas, intervalo, folgas e lacunas livres, em ordem.
 * Itens: {s, e, task} | {s, e, label} | {s, e, free: true}.
 */
function dayTimeline(emp, day) {
  const p = profileOf(emp);
  const ws = atTime(day, p.start);
  const we = atTime(day, p.end);
  const next = addDays(day, 1);
  const items = allTasks()
    .filter((t) => t.emp === emp && t.start >= day && t.start < next && [...OCCUPYING, 'concluida'].includes(t.status))
    .map((task) => ({ s: task.start, e: taskEnd(task), task }));
  items.push({ ...breakOf(p, day), label: 'Intervalo' });
  if (isWeeklyOff(p, day)) items.push({ s: ws, e: we, label: 'Folga semanal' });
  (p.off || []).filter((o) => o.e > ws && o.s < we).forEach((o) => items.push({
    s: Math.max(o.s, ws), e: Math.min(o.e, we), label: 'Indisponível' + (o.note ? ': ' + o.note : ''),
  }));
  items.sort((a, b) => a.s - b.s);

  const out = [];
  const minGap = SLOT_ROUND * MIN;
  let cursor = ws;
  for (const it of items) {
    if (it.s - cursor >= minGap) out.push({ s: cursor, e: it.s, free: true });
    out.push(it);
    cursor = Math.max(cursor, it.e);
  }
  if (we - cursor >= minGap) out.push({ s: cursor, e: we, free: true });
  return out;
}

/** Garante funcionário e visão válidos para a agenda (qualquer data pode ser vista). */
function normalizeAgenda() {
  // Funcionário: só a própria agenda. Administrador: a própria por padrão, pode ver a de qualquer um.
  if (state.me.role === 'func') ui.agendaEmp = state.uid;
  else if (!ui.agendaEmp || !executes(state.profiles[ui.agendaEmp])) {
    ui.agendaEmp = isAdmin() ? state.uid : employees()[0]?.id || null;
  }
  if (!AGENDA_VIEWS[ui.agendaView]) ui.agendaView = 'dia';
  ui.agendaDay = startOfDay(ui.agendaDay || Date.now());
}

// ---------- Visões: dia, semana e mês ----------
const AGENDA_VIEWS = { dia: 'Dia', semana: 'Semana', mes: 'Mês' };

/** Segunda-feira da semana de `ms`. */
const weekStart = (ms) => addDays(startOfDay(ms), -((new Date(ms).getDay() + 6) % 7));
const monthStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const addMonths = (ms, n) => { const d = new Date(monthStart(ms)); d.setMonth(d.getMonth() + n); return d.getTime(); };
/** "AAAA-MM-DD" no fuso local (valor do input date). */
const toDateInput = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const isInCurrentWeek = (ms) => { const w = currentWeek(); return ms >= w.s && ms < w.e; };

/** Período exibido: [início, fim) e o título. */
function agendaRange() {
  const day = ui.agendaDay;
  if (ui.agendaView === 'semana') {
    const s = weekStart(day);
    const e = addDays(s, 7);
    const short = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return { s, e, label: short(s) + ' – ' + short(e - 1) + '/' + new Date(e - 1).getFullYear() };
  }
  if (ui.agendaView === 'mes') {
    const s = monthStart(day);
    const label = new Date(s).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return { s, e: addMonths(s, 1), label: label.charAt(0).toUpperCase() + label.slice(1) };
  }
  return { s: day, e: addDays(day, 1),
    label: new Date(day).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) };
}

/** Avança/volta uma unidade da visão atual (dia, semana ou mês). */
function shiftAgenda(delta) {
  if (ui.agendaView === 'mes') {
    const d = new Date(ui.agendaDay);
    const target = addMonths(ui.agendaDay, delta);
    const last = new Date(new Date(target).getFullYear(), new Date(target).getMonth() + 1, 0).getDate();
    ui.agendaDay = addDays(target, Math.min(d.getDate(), last) - 1);
  } else {
    ui.agendaDay = addDays(ui.agendaDay, delta * (ui.agendaView === 'semana' ? 7 : 1));
  }
}

/**
 * Tarefas do funcionário no período, por dia: as com horário (agendadas, em andamento, concluídas…)
 * e as manutenções periódicas programadas (na data prevista). { [dia]: [{task, s}] }
 */
function agendaEntries(emp, from, to) {
  const byDay = {};
  for (const t of allTasks()) {
    if (t.emp !== emp) continue;
    let s = null;
    if (t.start && [...OCCUPYING, 'concluida'].includes(t.status)) s = t.start;
    else if (t.status === 'programada' && t.want) s = t.want;
    if (s === null || s < from || s >= to) continue;
    (byDay[startOfDay(s)] ||= []).push({ task: t, s });
  }
  Object.values(byDay).forEach((list) => list.sort((a, b) => a.s - b.s));
  return byDay;
}

/** Quem vê a agenda de outro só enxerga "Ocupado" nas tarefas que não pediu (o admin vê tudo). */
const isMasked = (t, canControl) => !canControl && !isAdmin() && t.req !== state.uid;

function agendaToolbar() {
  const { label } = agendaRange();
  const today = startOfDay(Date.now());
  return '<div class="agenda-bar">'
    + '<div class="seg" role="group" aria-label="Visualização da agenda">'
    + each(Object.entries(AGENDA_VIEWS), ([k, v]) => '<button class="small' + when(ui.agendaView === k, ' primary') + '" data-av="' + k + '"'
      + ' aria-pressed="' + (ui.agendaView === k) + '">' + v + '</button>') + '</div>'
    + '<div class="row nowrap agenda-nav">'
    + '<button class="small" data-day="-1" aria-label="Anterior">‹</button>'
    + '<b class="agenda-label">' + esc(label) + '</b>'
    + '<button class="small" data-day="1" aria-label="Próximo">›</button></div>'
    + '<div class="row nowrap agenda-go">'
    + '<button class="small" data-agtoday="1"' + when(ui.agendaView === 'dia' && ui.agendaDay === today, ' disabled') + '>Hoje</button>'
    + '<input type="date" id="ag_d" data-live value="' + toDateInput(ui.agendaDay) + '" aria-label="Ir para a data" title="Ir para a data"></div>'
    + '</div>';
}

/** Item compacto (semana/mês): horário + título; abre o dia ao tocar. */
function calItem({ task: t, s }, canControl) {
  const masked = isMasked(t, canControl);
  const prog = t.status === 'programada';
  return '<div class="cal-item prio-' + t.prio + when(t.status === 'concluida', ' done') + when(prog, ' prog') + '">'
    + '<span class="cal-time">' + (prog ? 'Prog.' : fmtTime(s)) + '</span> '
    + '<span class="cal-title" title="' + (masked ? 'Ocupado' : esc(t.title)) + '">'
    + (masked ? 'Ocupado' : esc(t.title.replace(/^Manutenção: /, ''))) + '</span></div>';
}

function weekView(emp, canControl) {
  const { s } = agendaRange();
  const entries = agendaEntries(emp, s, addDays(s, 7));
  const p = profileOf(emp);
  const today = startOfDay(Date.now());
  let html = '<div class="week-grid">';
  for (let i = 0; i < 7; i++) {
    const day = addDays(s, i);
    const list = entries[day] || [];
    const off = isWeeklyOff(p, day) || (p.off || []).some((o) => o.s <= atTime(day, p.start) && o.e >= atTime(day, p.end));
    html += '<button class="week-day' + when(day === today, ' today') + when(off, ' off') + '" data-agday="' + day + '">'
      + '<span class="week-head">' + new Date(day).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + '</span>'
      + (each(list, (x) => calItem(x, canControl)) || '<span class="muted cal-empty">' + (off ? 'Folga' : 'Sem tarefas') + '</span>')
      + '</button>';
  }
  return html + '</div><p class="muted">Toque num dia para abrir a agenda dele.</p>';
}

function monthView(emp, canControl) {
  const { s, e } = agendaRange();
  const entries = agendaEntries(emp, s, e);
  const today = startOfDay(Date.now());
  const lead = (new Date(s).getDay() + 6) % 7; // segunda = 0
  let html = '<div class="month-grid">'
    + each(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'], (d) => '<span class="month-dow">' + d + '</span>')
    + '<span class="month-blank"></span>'.repeat(lead);
  for (let day = s; day < e; day = addDays(day, 1)) {
    const list = entries[day] || [];
    html += '<button class="month-day' + when(day === today, ' today') + when(day === ui.agendaDay, ' selected') + '" data-agday="' + day + '"'
      + ' aria-label="' + new Date(day).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' }) + ': ' + plural(list.length || 0, 'tarefa', 'tarefas') + '">'
      + '<span class="month-num">' + new Date(day).getDate() + '</span>'
      + when(list.length, '<span class="month-dots">' + each(list.slice(0, 4), (x) => '<i class="dot prio-' + x.task.prio
        + when(x.task.status === 'programada', ' prog') + '"></i>') + '</span>'
        + '<span class="month-count">' + list.length + '</span>')
      + '<span class="month-items">' + each(list.slice(0, 3), (x) => calItem(x, canControl))
      + when(list.length > 3, '<span class="muted">+' + (list.length - 3) + '</span>') + '</span>'
      + '</button>';
  }
  return html + '</div><p class="muted">Toque num dia para abrir a agenda dele. "Prog." = manutenção periódica programada.</p>';
}

function proposalCard() {
  const fmt = (ms) => (ms ? fmtDayTime(ms) : 'pendente');
  return '<div class="card"><b>Sugestão de reorganização</b>'
    + each(ui.proposal, ({ task, start }) => '<div class="muted">' + esc(task.title) + ' (' + PRIORITY_LABEL[task.prio] + '): '
      + fmt(task.start) + ' → <b>' + fmt(start) + '</b></div>')
    + '<div class="row actions"><button class="primary small" data-ok="1">Aprovar</button><button class="small" data-no="1">Descartar</button></div></div>';
}

function viewAgenda() {
  normalizeAgenda();
  const emp = ui.agendaEmp;
  if (!emp) return emptyCard('Nenhum funcionário cadastrado ainda.');
  const canControl = emp === state.uid;
  let h = '';
  if (state.me.role !== 'func') {
    h += '<label>Funcionário</label><select id="selEmp" data-live>'
      + each(employees(), (e) => '<option value="' + e.id + '"' + when(e.id === emp, ' selected') + '>' + esc(e.name) + when(e.id === state.uid, ' (você)') + '</option>')
      + '</select>';
  }
  h += agendaToolbar();
  if (ui.agendaView === 'semana') h += weekView(emp, canControl);
  else if (ui.agendaView === 'mes') h += monthView(emp, canControl);
  else h += dayView(emp, canControl);

  const running = allTasks().filter((t) => t.emp === emp && STARTED.includes(t.status) && (canControl || t.req === state.uid));
  // Agenda à esquerda; tarefa em andamento fixa à direita (no celular, no topo).
  return '<div class="agenda-layout"><section class="agenda-main">' + h + '</section>'
    + '<aside class="agenda-side' + when(!running.length, ' side-empty') + '">' + runningPanel(running, canControl) + '</aside></div>';
}

/** Visão do dia: linha do tempo; na semana corrente, também as tarefas para agendar e os horários livres. */
function dayView(emp, canControl) {
  const day = ui.agendaDay;
  const p = profileOf(emp);
  const week = currentWeek();
  const editable = isInCurrentWeek(day);
  const tasksOf = (statuses) => allTasks().filter((t) => t.emp === emp && statuses.includes(t.status));
  let h = '<p class="muted">Jornada ' + esc(p.start) + '–' + esc(p.end) + ' · intervalo ' + esc(p.bs) + '–' + esc(p.be)
    + (editable ? ' · semana de agendamento: ' + fmtDay(week.s) + ' a ' + fmtDay(week.e - 1)
      : ' · fora da semana atual: só visualização') + '</p>';

  if (canControl && editable) {
    const waiting = tasksOf(['pendente', 'aguardando']);
    const open = openTasksForMe();
    h += '<div class="row toolbar"><button class="small" data-prop="1">Reorganizar agenda</button></div>'
      + '<h2>Tarefas para agendar</h2>'
      + (waiting.length || open.length
        ? '<div class="strip">' + each(waiting, dragCard) + each(open, openTaskCard) + '</div>'
          + '<p class="muted">Defina a duração e arraste o cartão (⠿) até um horário livre.'
          + when(open.length, ' Tarefas <b>abertas para a equipe</b>: o primeiro que aceitar fica com ela.') + '</p>'
        : '<p class="muted">Nenhuma tarefa aguardando.</p>');
  }
  if (ui.proposal) h += proposalCard();

  const programmed = agendaEntries(emp, day, addDays(day, 1))[day]?.filter((x) => x.task.status === 'programada') || [];
  h += each(programmed, (x) => taskCard(x.task, { canControl, masked: isMasked(x.task, canControl) }));
  h += each(dayTimeline(emp, day), (it) => {
    if (it.free) return editable ? freeSlots(it) : '<div class="card slot muted static">' + fmtTime(it.s) + '–' + fmtTime(it.e) + ' · livre</div>';
    if (it.label) return '<div class="card blocked">' + fmtTime(it.s) + '–' + fmtTime(it.e) + ' · ' + esc(it.label) + '</div>';
    // Horários de outros solicitantes aparecem como "Ocupado" (o administrador vê tudo).
    return taskCard(it.task, { canControl, masked: isMasked(it.task, canControl), draggable: editable });
  }) || emptyCard('Dia sem expediente.');

  if (!canControl) {
    const mine = tasksOf(UNSCHEDULED).filter((t) => t.req === state.uid);
    if (mine.length) h += '<h2>Aguardando aceite e pendentes</h2>' + each(mine, (t) => taskCard(t));
  }
  return h;
}

// ---------- Painel da tarefa em andamento ----------
/** "1 h 05 min" / "12 min". */
function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? h + ' h ' + String(m).padStart(2, '0') + ' min' : m + ' min';
}

function runningPanel(running, canControl) {
  const active = running.filter((t) => t.status === 'andamento');
  const paused = running.filter((t) => t.status === 'pausada');
  return '<h2>Em andamento</h2>'
    + (each(active, (t) => runningDetail(t, canControl)) || emptyCard('Nenhuma tarefa em andamento no momento.'))
    + when(paused.length, '<h2>Pausadas</h2>' + each(paused, (t) => taskCard(t, { canControl })));
}

/** Cartão grande e detalhado da tarefa em execução (progresso, prazos, dados e histórico). */
function runningDetail(t, canControl) {
  const now = Date.now();
  const end = taskEnd(t);
  const pct = Math.max(0, Math.min(100, Math.round(((now - t.start) / (end - t.start)) * 100)));
  const late = now > end;
  const device = t.dev ? state.devices[t.dev] : null;
  const item = (label, value) => '<dt>' + label + '</dt><dd>' + value + '</dd>';
  const moved = t.initial && t.initial !== t.start;

  return '<div class="card prio-' + t.prio + ' running running-detail" data-tid="' + t.id + '" data-goto="' + t.id + '"'
    + ' title="Ir para a tarefa na agenda">'
    + taskTimeHeader(t)
    + '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct + '%"></span></div>'
    + '<div class="row between muted"><span>Em execução há ' + fmtDuration(now - (t.startedAt || t.start)) + '</span>'
    + '<span class="' + when(late, 'error') + '">' + (late ? 'Atrasada ' + fmtDuration(now - end) : 'Faltam ' + fmtDuration(end - now)) + '</span></div>'
    + '<hr class="card-sep">'
    + '<div class="row between"><h3 class="detail-title">' + esc(t.title) + '</h3><span>' + statusTags(t) + '</span></div>'
    + when(t.desc, '<p class="detail-desc pre-wrap">' + esc(t.desc) + '</p>')
    + '<dl class="detail-list">'
    + item('Solicitante', esc(nameOf(t.req)))
    + item('Responsável', esc(nameOf(t.emp)))
    + item('Data', fmtDay(t.start))
    + item('Duração prevista', t.dur + ' min' + when(t.planDur && t.planDur !== t.dur, ' (planejado ' + t.planDur + ' min)'))
    + when(moved, item('Horário original', fmtDayTime(t.initial)))
    + when(device || t.devName, item('Aparelho', esc(device?.name || t.devName) + when(t.devArea, ' (' + esc(t.devArea) + ')')
      + when(t.devIp, ' · IP ' + esc(t.devIp)) + when(device, ' · ' + esc(device?.status || ''))))
    + when(t.preset, item('Problema', esc(t.preset)))
    + item('Criada em', fmtDateTime(t.created))
    + '</dl>'
    + '<div class="row actions">' + taskButtons(t, canControl, { withHistory: false }) + '</div>'
    + '<label>Histórico</label><div class="history flat detail-history">' + historyLines((t.hist || []).slice().reverse()) + '</div>'
    + '</div>';
}

/** Leva até o cartão da tarefa na agenda (troca o dia, se preciso) e destaca por um instante. */
function focusTaskInAgenda(id) {
  const t = state.tasks[id];
  if (!t?.start) return;
  const day = startOfDay(t.start);
  if (ui.agendaDay !== day || ui.agendaView !== 'dia') {
    ui.agendaDay = day;
    ui.agendaView = 'dia';
    render();
  }
  const el = $('.agenda-main [data-tid="' + id + '"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth; // reinicia a animação se clicar de novo
  el.classList.add('flash');
}
