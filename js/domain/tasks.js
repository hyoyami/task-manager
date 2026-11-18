/* ==========================================================================
   Operações sobre tarefas: criação, aceite, agendamento, execução e conclusão.
   Toda alteração passa por commitTask(), que também grava o histórico.
   ========================================================================== */
'use strict';

/** Cria uma notificação para `to` (não notifica o próprio autor da ação). */
async function notify(to, txt) {
  if (!to || to === state.uid) return;
  try {
    await newDoc('notifs').set({ company: state.me?.company || null, to, txt, at: Date.now() });
  } catch (err) {
    console.warn('Falha ao notificar', err);
  }
}

/**
 * Atualiza a tarefa e acrescenta `text` ao histórico.
 * O estado local é atualizado na hora (otimista), para que as regras de agenda
 * executadas logo em seguida já enxerguem a mudança, mesmo antes do onSnapshot.
 */
async function commitTask(id, patch, text) {
  const old = state.tasks[id] || {};
  const full = { ...patch, hist: [...(old.hist || []), { t: Date.now(), x: text }] };
  state.tasks[id] = { ...old, ...full };
  await doc('tasks/' + id).update(full);
}

const quote = (t) => '“' + t.title + '”';

/** Devolve uma tarefa agendada para "pendente" e avisa o solicitante. */
async function requeue(task, reason) {
  await commitTask(task.id, { status: 'pendente', start: null }, 'Reagendamento necessário (' + reason + ')');
  notify(task.req, 'Tarefa ' + quote(task) + ' será reagendada');
}

/** Agendadas do funcionário que colidem com o intervalo [s, e). */
const scheduledOverlapping = (emp, exceptId, s, e) => allTasks().filter((o) =>
  o.emp === emp && o.id !== exceptId && o.status === 'agendada' && o.start < e && taskEnd(o) > s);

/**
 * Encaixa as pendentes do funcionário (mais urgentes primeiro), seguindo a mesma regra do
 * aceite: passam na frente das agendadas de urgência menor (ver placeByPriority).
 */
async function scheduleWaiting(emp) {
  const waiting = allTasks()
    .filter((t) => t.emp === emp && t.status === 'pendente' && t.dur)
    .sort(byPriority((t) => t.created));
  for (const t of waiting) {
    if (state.tasks[t.id]?.status !== 'pendente') continue; // pode ter mudado no meio do laço
    await placeByPriority(state.tasks[t.id], (s) => 'Agendada para ' + fmtDayTime(s),
      (s) => 'Tarefa ' + quote(t) + ' agendada: ' + fmtDayTime(s));
  }
}

/**
 * Cria uma tarefa (status "aguardando") para cada funcionário escolhido.
 * @param {{title, desc, prio, emps: string[], link: object, want?: number}} form
 */
async function createTasks(form) {
  const device = form.link?.dev ? state.devices[form.link.dev] : null;
  // Ninguém escolhido: uma única tarefa "aberta para a equipe" (pool), que o primeiro elegível assume.
  const targets = form.emps.length ? form.emps : [null];
  for (const emp of targets) {
    const ref = newDoc('tasks');
    const now = Date.now();
    const pool = emp === null;
    await ref.set({
      id: ref.id,
      company: state.me.company,
      title: form.title,
      desc: form.desc,
      prio: form.prio,
      dur: null,
      ...form.link,
      emp,
      ...(pool ? { pool: true, cat: device ? device.area : (form.cat || null) } : {}),
      ...(form.rec ? { rec: form.rec } : {}),
      req: state.uid,
      status: 'aguardando',
      created: now,
      want: form.want || 0,
      start: null,
      initial: null,
      hist: [{ t: now, x: 'Tarefa criada' },
        { t: now, x: pool ? 'Aberta para a equipe' + (device || form.cat ? ' (' + (device ? device.area : form.cat) + ')' : '') : 'Enviada ao funcionário para aceite' },
        ...(form.rec ? [{ t: now, x: 'Manutenção periódica: ' + recurrenceLabel(form.rec) }] : [])],
      ...(device ? { devPrev: device.status || 'Operacional' } : {}),
    });
    const kind = 'Nova tarefa ' + PRIORITY_LABEL[form.prio].toLowerCase();
    if (pool) {
      const cat = device ? device.area : form.cat;
      employees().filter((p) => canTakeCategory(p, cat))
        .forEach((p) => notify(p.id, kind + ' aberta para a equipe: ' + quote(form)));
    } else {
      notify(emp, kind + ' para aceitar: ' + quote(form));
    }
  }
  // Manutenção periódica não deixa o aparelho inoperante: o status só muda quando ela é iniciada.
  if (device && !form.rec) {
    // Fica inoperante até o funcionário iniciar (se já houver outra em execução, segue em manutenção).
    const started = allTasks().some((o) => o.dev === device.id && STARTED.includes(o.status));
    await setDeviceStatus(device.id, started ? MAINTENANCE : INOPERATIVE, 'tarefa ' + quote(form) + ' aberta por ' + nameOf(state.uid));
  }
}

// ---------- Status do aparelho vinculado ----------
// Aberta (aguardando/pendente/agendada) → Inoperante; iniciada (andamento/pausada) → Em manutenção;
// encerrada → Operacional (concluída) ou status anterior (cancelada/recusada).
const INOPERATIVE = 'Inoperante';
const MAINTENANCE = 'Em manutenção';
/** Status que o sistema muda sozinho; os demais só mudam à mão ou ao abrir/iniciar uma tarefa. */
const AUTO_DEVICE_STATUSES = [INOPERATIVE, MAINTENANCE];
const STARTED = ['andamento', 'pausada'];

/** Status pedido pelas tarefas ainda abertas do aparelho (null se não houver nenhuma). */
function statusFromOpenTasks(devId) {
  // Periódicas só contam depois de iniciadas (antes disso o aparelho funciona normalmente).
  const open = allTasks().filter((o) => o.dev === devId && !FINISHED.includes(o.status)
    && !(o.rec && !STARTED.includes(o.status)));
  if (!open.length) return null;
  return open.some((o) => STARTED.includes(o.status)) ? MAINTENANCE : INOPERATIVE;
}

/** Funcionário iniciou a tarefa: o aparelho passa a "Em manutenção". */
async function markDeviceStarted(t) {
  if (!t.dev) return;
  const d = state.devices[t.dev];
  // Periódica: o "status anterior" é o do momento em que ela começa (para voltar a ele se for cancelada).
  if (t.rec && d && !AUTO_DEVICE_STATUSES.includes(d.status)) {
    state.tasks[t.id] = { ...state.tasks[t.id], devPrev: d.status || 'Operacional' };
    await doc('tasks/' + t.id).update({ devPrev: d.status || 'Operacional' });
  }
  await setDeviceStatus(t.dev, MAINTENANCE, 'tarefa ' + quote(t) + ' iniciada por ' + nameOf(t.emp));
}

/** Muda o status do aparelho (se for diferente) e registra no log. */
async function setDeviceStatus(id, status, reason) {
  const d = state.devices[id];
  if (!d || d.status === status) return;
  await addDeviceLog(id, 'Status: ' + (d.status || 'Operacional') + ' → ' + status + ' (' + reason + ')', { status });
}

/**
 * Ao encerrar uma tarefa de manutenção (se o status ainda for automático):
 * - com outras tarefas abertas para o aparelho, segue o que elas pedem;
 * - sem nenhuma, volta para Operacional (concluída) ou para o status anterior (cancelada/recusada).
 * Um status mudado manualmente (ex.: "Fora de uso") é respeitado.
 */
async function releaseDevice(t, action) {
  const d = state.devices[t.dev];
  if (!d || !AUTO_DEVICE_STATUSES.includes(d.status)) return;
  const pending = statusFromOpenTasks(t.dev);
  if (pending) return setDeviceStatus(t.dev, pending, 'outra tarefa aberta para o aparelho');
  const back = action === 'concluir' ? 'Operacional' : (t.devPrev || 'Operacional');
  await setDeviceStatus(t.dev, back, action === 'concluir' ? 'manutenção concluída' : 'tarefa ' + quote(t) + ' ' + (action === 'recusar' ? 'recusada' : 'cancelada'));
}

// ---------- Tarefas abertas para a equipe ----------
/** A pessoa atende tarefas da categoria? Admin: todas; funcionário: as da função; sem categoria: qualquer um. */
const canTakeCategory = (profile, cat) => executes(profile) && (!cat || canSeeCategory(profile, cat));

/** Tarefa aberta que o usuário logado pode assumir. */
const canTakeTask = (t) => !!t.pool && !t.emp && t.status === 'aguardando' && canTakeCategory(state.me, t.cat);

/** Abertas visíveis ao usuário logado. */
const openTasksForMe = () => allTasks().filter(canTakeTask);

/** Esperando o aceite do usuário logado: as enviadas para ele + as abertas que ele pode assumir (contador da aba Tarefas). */
const tasksToAccept = () => (executes(state.me)
  ? allTasks().filter((t) => (t.emp === state.uid && t.status === 'aguardando') || canTakeTask(t)) : []);

/**
 * Assume a tarefa aberta (o banco garante que só um consegue) e já agenda com a duração escolhida.
 */
async function claimTask(id, minutes) {
  const t = state.tasks[id];
  if (!t || !canTakeTask(t)) return say('Esta tarefa não está mais disponível.');
  if (!minutes) return say('Defina a duração antes.');
  try {
    await state.db.call('claim_task', { task_id: id });
  } catch (err) {
    return say(/já pegou|already/i.test(err.message) ? 'Outro funcionário já pegou esta tarefa.' : err.message);
  }
  state.tasks[id] = { ...t, emp: state.uid, hist: [...(t.hist || []), { t: Date.now(), x: 'Assumida por ' + nameOf(state.uid) }] };
  await commitTask(id, { dur: minutes }, 'Duração definida pelo funcionário: ' + minutes + ' min');
  notify(t.req, 'Tarefa ' + quote(t) + ' assumida por ' + nameOf(state.uid));
  await acceptTask(state.tasks[id]);
}

const hasRunningTask = (task) =>
  allTasks().some((o) => o.emp === task.emp && o.id !== task.id && o.status === 'andamento');

/** Aceite com agendamento automático no primeiro horário livre. */
/**
 * Aceite com agendamento automático, respeitando a urgência:
 * a tarefa ocupa o primeiro horário livre considerando só as tarefas iniciadas e as
 * agendadas de urgência igual ou maior; as agendadas de urgência menor que ficarem
 * no caminho são empurradas para depois (ver pushBackLowerPriority).
 */
async function acceptTask(t) {
  if (!t.dur) return say('Defina a duração antes.');
  const placed = await placeByPriority(t, (s) => 'Aceita e agendada para ' + fmtDayTime(s),
    (s) => 'Tarefa ' + quote(t) + ' aceita e agendada: ' + fmtDayTime(s));
  if (!placed) {
    await commitTask(t.id, { status: 'pendente' }, 'Aceita, sem horário livre nesta semana');
    notify(t.req, 'Tarefa ' + quote(t) + ' aceita, mas sem horário livre nesta semana — pendente');
  }
}

/**
 * Agenda `t` no primeiro horário livre considerando só as tarefas iniciadas e as agendadas de
 * urgência igual ou maior; as agendadas de urgência menor que ficarem no caminho são empurradas
 * para depois. Devolve false se não houver horário na semana.
 * `status`: 'agendada' (padrão) ou 'pausada' (reserva do tempo que falta). `histText`/`noteText` null:
 * sem histórico/aviso (reajuste silencioso da reserva de uma pausada).
 */
async function placeByPriority(t, histText, noteText, status = 'agendada') {
  const rank = PRIORITY_ORDER[t.prio];
  const isLower = (o) => o.status === 'agendada' && PRIORITY_ORDER[o.prio] > rank;
  const fixed = allTasks()
    .filter((o) => o.emp === t.emp && o.id !== t.id && o.start && OCCUPYING.includes(o.status) && !isLower(o))
    .map((o) => ({ s: o.start, e: taskEnd(o) }));
  const s = nextSlotFor(t, fixed);
  if (!s) return false;
  const patch = { status, start: s, initial: t.initial || s };
  if (histText) await commitTask(t.id, patch, histText(s));
  else await silentTaskUpdate(t.id, patch);
  if (noteText) notify(t.req, noteText(s));
  const displaced = allTasks().filter((o) => o.emp === t.emp && o.id !== t.id && isLower(o) && taskEnd(o) > s);
  await pushBackLowerPriority(t, displaced, [...fixed, { s, e: s + remainingMin(t) * MIN }]);
  return true;
}

/** Atualiza a tarefa sem entrada no histórico (reajustes automáticos repetidos). */
async function silentTaskUpdate(id, patch) {
  state.tasks[id] = { ...state.tasks[id], ...patch };
  await doc('tasks/' + id).update(patch);
}

/**
 * Reencaixa as tarefas de urgência menor que estão depois de `urgent`, na ordem em que estavam:
 * cada uma fica no primeiro horário livre a partir do seu horário atual (as que não colidem não mudam).
 */
async function pushBackLowerPriority(urgent, displaced, busy) {
  for (const o of displaced.sort((a, b) => a.start - b.start)) {
    if (!busy.some((b) => o.start < b.e && taskEnd(o) > b.s)) {
      busy.push({ s: o.start, e: taskEnd(o) }); // não colide: fica onde está
      continue;
    }
    const s = findSlot(profileOf(o.emp), busy, remainingMin(o), Math.max(Date.now(), o.want || 0, o.start));
    if (s) {
      busy.push({ s, e: s + remainingMin(o) * MIN });
      await commitTask(o.id, { status: 'agendada', start: s, initial: o.initial || o.start },
        'Reorganizada por prioridade (' + quote(urgent) + ' é mais urgente): ' + fmtDayTime(s));
      notify(o.req, 'Tarefa ' + quote(o) + ' reagendada por prioridade: ' + fmtDayTime(s));
    } else {
      await requeue(o, 'tarefa mais urgente ocupou o horário');
    }
  }
}

/** Iniciar antes do horário: puxa a tarefa para agora e desloca as que colidirem. */
async function startEarly(t) {
  const now = Date.now();
  const end = now + remainingMin(t) * MIN;
  for (const o of scheduledOverlapping(t.emp, t.id, now, end)) await requeue(o, 'outra tarefa foi iniciada antes');
  await commitTask(t.id, { status: 'andamento', start: now, startedAt: now, initial: t.initial || t.start },
    'Iniciada antes do previsto (' + fmtTime(now) + '; previsto ' + fmtTime(t.start) + ')');
  await markDeviceStarted(t);
  notify(t.req, 'Tarefa ' + quote(t) + ' iniciada');
  await reflowPausedTasks(); // a pausada que estava reservada aqui vai para depois
  await scheduleWaiting(t.emp);
}

// ---------- Pausar / retomar ----------
// Ao pausar, `worked` guarda os minutos já feitos e a tarefa reserva na agenda só o que falta, no
// próximo horário livre (pela urgência). Outra tarefa pode ser iniciada no lugar; a pausada só volta
// a andar com "Retomar" e, enquanto isso, a reserva é sempre reajustada (ver reflowPausedTasks).

/** Minutos do trecho em andamento (desde que iniciou ou foi retomada). */
const runningSegmentMin = (t, now = Date.now()) =>
  (t.status === 'andamento' ? Math.max(0, Math.round((now - (t.resumedAt || t.startedAt || t.start || now)) / MIN)) : 0);

/** Minutos já trabalhados na tarefa (trechos anteriores + o atual). */
const workedMin = (t, now = Date.now()) => (t.worked || 0) + runningSegmentMin(t, now);

async function pauseTask(t) {
  const now = Date.now();
  const worked = Math.min(t.dur, workedMin(t, now));
  const left = Math.max(SLOT_ROUND, t.dur - worked);
  await commitTask(t.id, { status: 'pausada', worked, pausedAt: now, start: now },
    'Pausada (' + worked + ' de ' + t.dur + ' min feitos; faltam ' + left + ' min)');
  notify(t.req, 'Tarefa ' + quote(t) + ' pausada');
  await placePaused(state.tasks[t.id], true);
}

/** Reserva o tempo que falta da pausada no próximo horário livre. `announce`: registra no histórico. */
async function placePaused(t, announce = false) {
  const ok = await placeByPriority({ ...t, want: 0 }, announce ? (s) => 'Restante reservado para ' + fmtDayTime(s) : null, null, 'pausada');
  if (!ok && t.start !== null) {
    if (announce) await commitTask(t.id, { start: null }, 'Sem horário livre nesta semana para o restante');
    else await silentTaskUpdate(t.id, { start: null });
  }
}

async function resumeTask(t) {
  const now = Date.now();
  const left = remainingMin(t);
  for (const o of scheduledOverlapping(t.emp, t.id, now, now + left * MIN)) await requeue(o, 'tarefa pausada foi retomada');
  await commitTask(t.id, { status: 'andamento', start: now, resumedAt: now }, 'Retomada (faltam ' + left + ' min)');
  notify(t.req, 'Tarefa ' + quote(t) + ' retomada');
  await reflowPausedTasks();
  await scheduleWaiting(t.emp);
}

/**
 * Reajusta a reserva das pausadas do usuário logado:
 * - não vale mais (o horário passou sem retomar, outra tarefa ocupou o lugar, virou folga/feriado/fora do
 *   expediente, ou ainda sem horário) → vai para o próximo horário livre, pela urgência;
 * - abriu um horário livre antes dela (ex.: outra tarefa foi puxada para agora ou concluída antes) → adianta.
 */
let reflowingPaused = false;
async function reflowPausedTasks() {
  if (reflowingPaused || !state.uid) return;
  const paused = allTasks().filter((t) => t.emp === state.uid && t.status === 'pausada' && t.dur);
  if (!paused.length) return;
  reflowingPaused = true;
  try {
    for (const p of paused.sort(byPriority((x) => x.pausedAt || x.created))) {
      const t = state.tasks[p.id];
      if (!t.start || !fitsAt(t, t.start)) {
        await placePaused(t);
        continue;
      }
      const earlier = findSlot(profileOf(t.emp), busyIntervals(t.emp, t.id), remainingMin(t), Date.now());
      if (earlier && earlier < t.start) await silentTaskUpdate(t.id, { start: earlier });
    }
  } finally {
    reflowingPaused = false;
  }
}

/** Transições simples: ação → [novo status, texto do histórico]. */
const TRANSITIONS = {
  recusar: ['cancelada', 'Recusada'],
  iniciar: ['andamento', 'Iniciada'],
  pausar: ['pausada', 'Pausada'],
  retomar: ['andamento', 'Retomada'],
  concluir: ['concluida', 'Concluída'],
  cancelar: ['cancelada', 'Cancelada'],
};

/**
 * Executa uma ação de botão sobre a tarefa.
 * @param {string} id
 * @param {'aceitar'|'recusar'|'iniciar'|'pausar'|'retomar'|'concluir'|'cancelar'} action
 * @param {string} [summary] relato ao concluir
 */
async function taskAction(id, action, summary) {
  const t = state.tasks[id];
  if (!t) return;
  if ((action === 'iniciar' || action === 'retomar') && hasRunningTask(t)) {
    return say('Já há uma tarefa em andamento. Pause ou conclua antes de iniciar outra.');
  }
  if (action === 'iniciar' && t.start && t.start > Date.now() + MIN) return startEarly(t);
  if (action === 'aceitar') return acceptTask(t);
  if (action === 'pausar') return pauseTask(t);
  if (action === 'retomar') return resumeTask(t);

  const tr = TRANSITIONS[action];
  if (!tr) return;
  const [status, label] = tr;
  const patch = { status };
  let note = '';

  if (action === 'iniciar') patch.startedAt = Date.now();
  if (action === 'cancelar' && t.status === 'pausada') patch.start = t.pausedAt || t.start; // libera a reserva
  if (action === 'concluir') {
    // Concluir antes do previsto encurta a duração e libera o horário.
    if (t.worked || (t.status === 'pausada' && t.start)) {
      // Teve pausa: vira um bloco só com o tempo trabalhado, terminando agora (libera a reserva).
      const now = Date.now();
      const elapsed = Math.max(1, workedMin(t, now));
      Object.assign(patch, { dur: elapsed, worked: 0, start: now - elapsed * MIN, ...(elapsed < t.dur ? { planDur: t.dur } : {}) });
      note = ' (' + elapsed + ' de ' + t.dur + ' min trabalhados)';
    } else if (t.status === 'andamento' && t.start) {
      const elapsed = Math.max(1, Math.ceil((Date.now() - (t.startedAt || t.start)) / MIN));
      if (elapsed < t.dur) {
        Object.assign(patch, { dur: elapsed, planDur: t.dur });
        note = ' antes do previsto (' + elapsed + ' de ' + t.dur + ' min)';
      }
    }
    if (summary) {
      patch.summary = summary;
      note += ' — resumo: ' + summary;
    }
  }
  await commitTask(id, patch, label + note);

  if (action === 'concluir' && t.dev) {
    await addDeviceLog(t.dev, 'Manutenção concluída: ' + quote(t) + ' (pedida por ' + nameOf(t.req) + ')'
      + (summary ? ' — Relato: ' + summary : ' — sem relato'));
  }
  if (t.dev && ['concluir', 'cancelar', 'recusar'].includes(action)) await releaseDevice(t, action);
  if (action === 'concluir' && t.rec) await scheduleNextOccurrence(state.tasks[id]);
  if (['concluir', 'cancelar', 'recusar'].includes(action)) {
    const extra = action === 'concluir' && summary ? ' — ' + summary.slice(0, 120) : '';
    notify(t.req, 'Tarefa ' + quote(t) + ': ' + label.toLowerCase() + extra);
    // Reencaixar a agenda mexe em tarefas de outros solicitantes: só o próprio funcionário faz.
    if (t.emp === state.uid) {
      await scheduleWaiting(t.emp);
      await reflowPausedTasks();
    }
  } else if (action === 'iniciar') {
    await markDeviceStarted(t);
    notify(t.req, 'Tarefa ' + quote(t) + ' iniciada');
    await reflowPausedTasks();
  }
}

/** Define a duração de uma tarefa ainda sem horário (ou ajusta, se já agendada). */
async function setDuration(id, minutes) {
  const t = state.tasks[id];
  if (!t) return;
  if (t.dur && t.start) return changeDuration(id, minutes - t.dur);
  await commitTask(id, { dur: minutes }, 'Duração definida pelo funcionário: ' + minutes + ' min');
  notify(t.req, 'Duração de ' + quote(t) + ': ' + minutes + ' min');
}

/** Soma `delta` minutos à duração (mín. 15) e reagenda o que colidir. */
async function changeDuration(id, delta) {
  const t = state.tasks[id];
  const dur = Math.max(SLOT_ROUND, t.dur + delta);
  if (dur === t.dur) return;
  await commitTask(id, { dur }, 'Duração: ' + t.dur + ' → ' + dur + ' min');
  if (!t.start) return;
  const end = t.start + remainingMin({ ...t, dur }) * MIN;
  const clashes = allTasks().filter((o) =>
    o.emp === t.emp && o.id !== id && o.status === 'agendada' && o.start >= t.start && o.start < end);
  for (const o of clashes) await requeue(o, 'duração de outra tarefa mudou');
  await reflowPausedTasks();
  await scheduleWaiting(t.emp);
}

/** Agenda (ou move) a tarefa para começar em `start` — arrastar ou tocar no horário. */
async function scheduleAt(id, start) {
  const t = state.tasks[id];
  if (!t) return;
  if (!t.dur) return say('Defina a duração antes de arrastar.');
  if (!fitsAt(t, start)) return say('Não cabe nesse horário.');
  const first = t.status !== 'agendada';
  await commitTask(id, { status: 'agendada', start, initial: t.initial || start },
    (first ? 'Agendada' : 'Movida') + ' para ' + fmtDayTime(start));
  notify(t.req, 'Tarefa ' + quote(t) + ' ' + (first ? 'agendada' : 'reagendada') + ': ' + fmtDayTime(start));
  say('Agendada: ' + fmtTime(start) + ' · ' + t.dur + ' min');
}

/** Aplica a sugestão de reorganização aprovada. */
async function applyProposal() {
  for (const { task: t, start } of ui.proposal || []) {
    if (start === t.start) continue;
    if (start) {
      await commitTask(t.id, { status: 'agendada', start, initial: t.initial || start }, 'Reagendada para ' + fmtDayTime(start));
      notify(t.req, 'Tarefa ' + quote(t) + ' reagendada: ' + fmtDayTime(start));
    } else {
      await commitTask(t.id, { status: 'pendente', start: null }, 'Sem horário após reorganização');
      notify(t.req, 'Tarefa ' + quote(t) + ' voltou a pendente');
    }
  }
  ui.proposal = null;
}

// ---------- Ausência no dia ----------
/** O funcionário está marcado como ausente (folga cobrindo o dia todo) no dia `day`? */
const isAbsentOn = (profile, day) => (profile.off || []).some((o) => o.s <= day && o.e >= addDays(day, 1));

/** Agendadas do usuário logado no dia `day`. */
const scheduledOnDay = (day) => allTasks().filter((t) => t.emp === state.uid && t.status === 'agendada'
  && t.start >= day && t.start < addDays(day, 1));

/**
 * Marca o dia de hoje como ausente (folga só desse dia) e leva as tarefas agendadas para hoje
 * para o dia seguinte (o primeiro horário livre a partir dele, pela urgência; pula folgas e feriados).
 * Devolve { moved, pending }: quantas foram reagendadas e quantas ficaram pendentes (sem vaga na semana).
 */
async function markAbsentToday() {
  const day = startOfDay(Date.now());
  const next = addDays(day, 1);
  const label = new Date(day).toLocaleDateString('pt-BR');
  const p = profileOf(state.uid);
  if (isAbsentOn(p, day)) return { moved: 0, pending: 0, already: true };
  const hit = scheduledOnDay(day).sort(byPriority((t) => t.start));
  await patchMyProfile({ off: [...(p.off || []), { s: day, e: next, note: 'Ausente' }] });
  for (const t of hit) {
    await commitTask(t.id, { status: 'pendente', start: null, want: next }, 'Funcionário ausente em ' + label + ': vai para o dia seguinte');
  }
  let moved = 0;
  for (const t of hit) {
    const placed = await placeByPriority(state.tasks[t.id], (s) => 'Reagendada (ausência em ' + label + '): ' + fmtDayTime(s),
      (s) => 'Tarefa ' + quote(t) + ' reagendada para ' + fmtDayTime(s) + ' (' + nameOf(state.uid) + ' ausente em ' + label + ')');
    if (placed) moved++;
    else notify(t.req, 'Tarefa ' + quote(t) + ' ficou pendente: ' + nameOf(state.uid) + ' está ausente e não há horário livre nesta semana');
  }
  return { moved, pending: hit.length - moved };
}

/** Na virada da semana (e ao abrir o sistema), as pendentes do funcionário entram na agenda nova. */
let lastWeekScheduled = null;
async function scheduleNewWeek() {
  const key = currentWeek().s;
  if (!state.uid || lastWeekScheduled === key || !executes(state.me)) return;
  lastWeekScheduled = key;
  if (allTasks().some((t) => t.emp === state.uid && t.status === 'pendente' && t.dur)) await scheduleWaiting(state.uid);
}

/** Devolve para "pendente" as agendadas que caíram em folga e reagenda. */
async function requeueForTimeOff(isBlocked, reason) {
  const hit = allTasks().filter((t) => t.emp === state.uid && t.status === 'agendada' && isBlocked(t));
  for (const t of hit) await requeue(t, reason);
  await reflowPausedTasks();
  await scheduleWaiting(state.uid);
}

/** Momento em que a tarefa foi concluída/cancelada (pelo histórico). */
const finishedAt = (t) =>
  (t.hist || []).slice().reverse().find((h) => /Conclu|Cancel|Recus/.test(h.x))?.t || t.created;

// ---------- Manutenção periódica ----------
// Tarefa com `rec: {n, u}` (u = 'd' | 'm' | 'y'). Ao ser concluída, nasce a próxima ocorrência
// (mesmo aparelho, responsável e duração, prioridade alta) com status "programada" e `want` = data.
// Na semana dessa data ela vira pendente (ou aguardando, sem duração/responsável) e entra na agenda.

/** "a cada 3 meses". */
const recurrenceLabel = (rec) => 'a cada ' + plural(rec.n, ...RECURRENCE_UNITS[rec.u]);

/** Data (início do dia) `rec` depois de `from`. */
function addRecurrence(from, rec) {
  const d = new Date(startOfDay(from));
  if (rec.u === 'd') d.setDate(d.getDate() + rec.n);
  if (rec.u === 'm') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + rec.n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); // 31/01 + 1 mês = 28/02
  }
  if (rec.u === 'y') {
    const month = d.getMonth();
    d.setFullYear(d.getFullYear() + rec.n);
    if (d.getMonth() !== month) d.setDate(0); // 29/02 → 28/02
  }
  return d.getTime();
}

/** Cria a próxima ocorrência da periódica concluída `t`. */
async function scheduleNextOccurrence(t) {
  const now = Date.now();
  const due = addRecurrence(now, t.rec);
  const ref = newDoc('tasks');
  const keep = ['company', 'title', 'desc', 'dev', 'devName', 'devArea', 'devIp', 'tipo', 'preset', 'pool', 'cat', 'req', 'emp', 'rec'];
  const next = Object.fromEntries(keep.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
  await ref.set({
    ...next,
    id: ref.id,
    prio: 'alta',
    dur: t.planDur || t.dur || null,
    status: 'programada',
    created: now,
    want: due,
    start: null,
    initial: null,
    series: t.series || t.id,
    hist: [{ t: now, x: 'Manutenção periódica (' + recurrenceLabel(t.rec) + '): próxima ocorrência programada para '
      + new Date(due).toLocaleDateString('pt-BR') }],
  });
  if (t.dev) await addDeviceLog(t.dev, 'Manutenção periódica ' + quote(t) + ': próxima em ' + new Date(due).toLocaleDateString('pt-BR'));
  notify(t.req, 'Manutenção periódica ' + quote(t) + ' concluída; próxima em ' + new Date(due).toLocaleDateString('pt-BR'));
  await activateDueTasks();
}

let activatingDue = false;

/**
 * Periódicas programadas cuja data cai na semana atual (ou já passou) entram na agenda.
 * Roda no navegador do responsável (que também as encaixa) e do solicitante.
 */
async function activateDueTasks() {
  if (activatingDue || !state.uid) return;
  const limit = currentWeek().e;
  const due = allTasks().filter((t) => t.status === 'programada' && (t.want || 0) < limit
    && (t.emp === state.uid || t.req === state.uid));
  if (!due.length) return;
  activatingDue = true;
  try {
    for (const t of due) {
      const ready = t.emp && t.dur;
      await commitTask(t.id, { status: ready ? 'pendente' : 'aguardando' },
        'Chegou a semana da manutenção periódica (' + new Date(t.want).toLocaleDateString('pt-BR') + ')');
      notify(t.emp, 'Manutenção periódica ' + quote(t) + ' entrou na agenda desta semana');
    }
    if (due.some((t) => t.emp === state.uid)) await scheduleWaiting(state.uid);
  } finally {
    activatingDue = false;
  }
}
