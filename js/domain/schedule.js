/* ==========================================================================
   Regras de agenda: semana visível, horários livres e disponibilidade.
   Funções puras (só leem `state`), sem escrita no banco.
   ========================================================================== */
'use strict';

/** Fim previsto da tarefa (ms). */
const taskEnd = (t) => t.start + t.dur * MIN;

/**
 * Semana corrente limitada ao mês corrente: { s, e } (e exclusivo).
 * Ex.: se a semana começa no dia 29 e o mês acaba no 30, vai de 29 a 30.
 */
function currentWeek() {
  const now = new Date();
  const monday = addDays(startOfDay(now), -((now.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return { s: Math.max(monday, monthStart), e: Math.min(addDays(monday, 7), monthEnd) };
}

/** O dia de `ms` é folga semanal do perfil? */
const isWeeklyOff = (profile, ms) => (profile.wk || []).includes(new Date(ms).getDay());

/** Intervalo de almoço do dia. */
const breakOf = (profile, day) => ({ s: atTime(day, profile.bs), e: atTime(day, profile.be) });

/** Horários já ocupados por tarefas do funcionário (exceto `exceptId`). */
function busyIntervals(emp, exceptId, statuses = OCCUPYING) {
  return allTasks()
    .filter((t) => t.emp === emp && t.id !== exceptId && t.start && statuses.includes(t.status))
    .map((t) => ({ s: t.start, e: taskEnd(t) }));
}

/**
 * Primeiro horário livre (ms) com `dur` minutos a partir de `from`, dentro da
 * semana corrente, respeitando jornada, intervalo, folgas e `busy`. null se não houver.
 */
function findSlot(profile, busy, dur, from) {
  const step = SLOT_ROUND * MIN;
  from = Math.ceil(from / step) * step;
  const need = dur * MIN;
  for (let day = startOfDay(from); day < currentWeek().e; day = addDays(day, 1)) {
    if (isWeeklyOff(profile, day)) continue;
    const ws = atTime(day, profile.start);
    const we = atTime(day, profile.end);
    const blocks = [...busy, ...(profile.off || []), breakOf(profile, day)]
      .filter((b) => b.e > ws && b.s < we)
      .sort((a, b) => a.s - b.s);
    let cursor = Math.max(ws, from);
    for (const b of blocks) {
      if (b.s - cursor >= need) return cursor;
      cursor = Math.max(cursor, b.e);
    }
    if (we - cursor >= need) return cursor;
  }
  return null;
}

/** A tarefa cabe começando em `start` (arrastar/tocar num horário)? */
function fitsAt(task, start) {
  const p = profileOf(task.emp);
  const day = startOfDay(start);
  const end = start + task.dur * MIN;
  if (start < atTime(day, p.start) || end > atTime(day, p.end)) return false;
  if (start < Date.now() - SLOT_ROUND * MIN || isWeeklyOff(p, start)) return false;
  const blocks = [...busyIntervals(task.emp, task.id), ...(p.off || []), breakOf(p, day)];
  return !blocks.some((b) => start < b.e && end > b.s);
}

/** Primeiro horário livre para uma tarefa, a partir de agora (ou da data desejada). */
const nextSlotFor = (task, busy) =>
  findSlot(profileOf(task.emp), busy, task.dur, Math.max(Date.now(), task.want || 0));

/** Ordena por prioridade e depois por `key` (mais antigo primeiro). */
const byPriority = (key) => (a, b) => PRIORITY_ORDER[a.prio] - PRIORITY_ORDER[b.prio] || key(a) - key(b);

/**
 * Sugestão de reorganização: reencaixa agendadas e pendentes por prioridade,
 * mantendo fixas as tarefas em andamento/pausadas. Retorna [{task, start}].
 */
function buildProposal(emp) {
  const busy = busyIntervals(emp, null, ['andamento', 'pausada']);
  return allTasks()
    .filter((t) => t.emp === emp && ['agendada', 'pendente'].includes(t.status))
    .sort(byPriority((t) => t.initial || t.created))
    .map((task) => {
      const start = nextSlotFor(task, busy);
      if (start) busy.push({ s: start, e: start + task.dur * MIN });
      return { task, start };
    });
}

/** Situação atual do funcionário para a aba Equipe: { k, x } (k ∈ AVAILABILITY). */
function employeeStatus(id) {
  const p = profileOf(id);
  const now = Date.now();
  const today = startOfDay(now);
  const running = allTasks().find((t) => t.emp === id && t.status === 'andamento');
  if (running) return { k: 'busy', x: 'Executando: ' + running.title };
  const off = (p.off || []).find((o) => now >= o.s && now < o.e);
  if (off) return { k: 'off', x: 'De folga' + (off.note ? ' (' + off.note + ')' : '') + ' até ' + fmtDay(off.e - 1) };
  if (isWeeklyOff(p, now)) return { k: 'off', x: 'Folga semanal' };
  if (now < atTime(today, p.start) || now >= atTime(today, p.end)) {
    return { k: 'off', x: 'Fora do expediente (' + p.start + '–' + p.end + ')' };
  }
  const br = breakOf(p, today);
  if (now >= br.s && now < br.e) return { k: 'off', x: 'Em intervalo até ' + p.be };
  return { k: 'free', x: 'Pode receber tarefas' };
}
