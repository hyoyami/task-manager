/* ==========================================================================
   Aba Agenda: dia a dia da semana corrente de um funcionário.
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

/** Garante funcionário e dia válidos para a agenda. */
function normalizeAgenda() {
  if (isEmployee()) ui.agendaEmp = state.uid;
  else if (!ui.agendaEmp || !state.profiles[ui.agendaEmp]) ui.agendaEmp = employees()[0]?.id || null;
  const week = currentWeek();
  if (ui.agendaDay < week.s || ui.agendaDay >= week.e) {
    ui.agendaDay = Math.min(Math.max(startOfDay(Date.now()), week.s), week.e - 1);
  }
  return week;
}

function proposalCard() {
  const fmt = (ms) => (ms ? fmtDayTime(ms) : 'pendente');
  return '<div class="card"><b>Sugestão de reorganização</b>'
    + each(ui.proposal, ({ task, start }) => '<div class="muted">' + esc(task.title) + ' (' + PRIORITY_LABEL[task.prio] + '): '
      + fmt(task.start) + ' → <b>' + fmt(start) + '</b></div>')
    + '<div class="row actions"><button class="primary small" data-ok="1">Aprovar</button><button class="small" data-no="1">Descartar</button></div></div>';
}

function viewAgenda() {
  const week = normalizeAgenda();
  const emp = ui.agendaEmp;
  if (!emp) return emptyCard('Nenhum funcionário cadastrado ainda.');

  const day = ui.agendaDay;
  const p = profileOf(emp);
  const canControl = emp === state.uid;
  const tasksOf = (statuses) => allTasks().filter((t) => t.emp === emp && statuses.includes(t.status));
  let h = '';

  if (!isEmployee()) {
    h += '<label>Funcionário</label><select id="selEmp">'
      + each(employees(), (e) => '<option value="' + e.id + '"' + when(e.id === emp, ' selected') + '>' + esc(e.name) + '</option>')
      + '</select>';
  }
  h += '<div class="row between"><button class="small" data-day="-1"' + when(day <= week.s, ' disabled') + '>‹</button>'
    + '<b>' + fmtDay(day) + '</b>'
    + '<button class="small" data-day="1"' + when(addDays(day, 1) >= week.e, ' disabled') + '>›</button></div>'
    + '<p class="muted">Semana de ' + fmtDay(week.s) + ' a ' + fmtDay(week.e - 1) + '</p>'
    + '<p class="muted">Jornada ' + esc(p.start) + '–' + esc(p.end) + ' · intervalo ' + esc(p.bs) + '–' + esc(p.be) + '</p>';

  if (canControl) {
    const waiting = tasksOf(['pendente', 'aguardando']);
    h += '<div class="row toolbar"><button class="small" data-prop="1">Reorganizar agenda</button></div>'
      + '<h2>Tarefas para agendar</h2>'
      + (waiting.length
        ? '<div class="strip">' + each(waiting, dragCard) + '</div><p class="muted">Defina a duração e arraste o cartão (⠿) até um horário livre.</p>'
        : '<p class="muted">Nenhuma tarefa aguardando.</p>');
  }

  const running = tasksOf(['andamento', 'pausada']).filter((t) => canControl || t.req === state.uid);
  if (running.length) h += '<h2>Em andamento</h2>' + each(running, (t) => taskCard(t, { canControl }));

  if (ui.proposal) h += proposalCard();

  h += each(dayTimeline(emp, day), (it) => {
    if (it.free) return freeSlots(it);
    if (it.label) return '<div class="card blocked">' + fmtTime(it.s) + '–' + fmtTime(it.e) + ' · ' + esc(it.label) + '</div>';
    return taskCard(it.task, { canControl, masked: !canControl && it.task.req !== state.uid, draggable: true });
  }) || emptyCard('Dia sem expediente.');

  if (!canControl) {
    const mine = tasksOf(UNSCHEDULED).filter((t) => t.req === state.uid);
    if (mine.length) h += '<h2>Aguardando aceite e pendentes</h2>' + each(mine, (t) => taskCard(t));
  }
  return h;
}
