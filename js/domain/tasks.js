/* ==========================================================================
   Operações sobre tarefas: criação, aceite, agendamento, execução e conclusão.
   Toda alteração passa por commitTask(), que também grava o histórico.
   ========================================================================== */
'use strict';

/** Cria uma notificação para `to` (não notifica o próprio autor da ação). */
async function notify(to, txt) {
  if (!to || to === state.uid) return;
  try {
    await newDoc('notifs').set({ to, txt, at: Date.now() });
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
  for (const emp of form.emps) {
    const ref = newDoc('tasks');
    const now = Date.now();
    await ref.set({
      id: ref.id,
      title: form.title,
      desc: form.desc,
      prio: form.prio,
      dur: null,
      ...form.link,
      emp,
      req: state.uid,
      status: 'aguardando',
      created: now,
      want: form.want || 0,
      start: null,
      initial: null,
      hist: [{ t: now, x: 'Tarefa criada' }, { t: now, x: 'Enviada ao funcionário para aceite' }],
      ...(device ? { devPrev: device.status || 'Operacional' } : {}),
    });
    notify(emp, 'Nova tarefa ' + PRIORITY_LABEL[form.prio].toLowerCase() + ' para aceitar: ' + quote(form));
  }
  if (device) {
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
  const open = allTasks().filter((o) => o.dev === devId && !FINISHED.includes(o.status));
  if (!open.length) return null;
  return open.some((o) => STARTED.includes(o.status)) ? MAINTENANCE : INOPERATIVE;
}

/** Funcionário iniciou a tarefa: o aparelho passa a "Em manutenção". */
async function markDeviceStarted(t) {
  if (t.dev) await setDeviceStatus(t.dev, MAINTENANCE, 'tarefa ' + quote(t) + ' iniciada por ' + nameOf(t.emp));
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
 */
async function placeByPriority(t, histText, noteText) {
  const rank = PRIORITY_ORDER[t.prio];
  const isLower = (o) => o.status === 'agendada' && PRIORITY_ORDER[o.prio] > rank;
  const fixed = allTasks()
    .filter((o) => o.emp === t.emp && o.id !== t.id && o.start && OCCUPYING.includes(o.status) && !isLower(o))
    .map((o) => ({ s: o.start, e: taskEnd(o) }));
  const s = nextSlotFor(t, fixed);
  if (!s) return false;
  await commitTask(t.id, { status: 'agendada', start: s, initial: t.initial || s }, histText(s));
  notify(t.req, noteText(s));
  const displaced = allTasks().filter((o) => o.emp === t.emp && o.id !== t.id && isLower(o) && taskEnd(o) > s);
  await pushBackLowerPriority(t, displaced, [...fixed, { s, e: s + t.dur * MIN }]);
  return true;
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
    const s = findSlot(profileOf(o.emp), busy, o.dur, Math.max(Date.now(), o.want || 0, o.start));
    if (s) {
      busy.push({ s, e: s + o.dur * MIN });
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
  const end = now + t.dur * MIN;
  const pausedClash = allTasks().some((o) =>
    o.emp === t.emp && o.id !== t.id && o.status === 'pausada' && o.start < end && taskEnd(o) > now);
  if (pausedClash) return say('Esse horário conflita com uma tarefa pausada.');
  for (const o of scheduledOverlapping(t.emp, t.id, now, end)) await requeue(o, 'outra tarefa foi iniciada antes');
  await commitTask(t.id, { status: 'andamento', start: now, startedAt: now, initial: t.initial || t.start },
    'Iniciada antes do previsto (' + fmtTime(now) + '; previsto ' + fmtTime(t.start) + ')');
  await markDeviceStarted(t);
  notify(t.req, 'Tarefa ' + quote(t) + ' iniciada');
  await scheduleWaiting(t.emp);
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

  const tr = TRANSITIONS[action];
  if (!tr) return;
  const [status, label] = tr;
  const patch = { status };
  let note = '';

  if (action === 'iniciar') patch.startedAt = Date.now();
  if (action === 'concluir') {
    // Concluir antes do previsto encurta a duração e libera o horário.
    if (t.status === 'andamento' && t.start) {
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
  if (['concluir', 'cancelar', 'recusar'].includes(action)) {
    const extra = action === 'concluir' && summary ? ' — ' + summary.slice(0, 120) : '';
    notify(t.req, 'Tarefa ' + quote(t) + ': ' + label.toLowerCase() + extra);
    await scheduleWaiting(t.emp);
  } else if (action === 'iniciar') {
    await markDeviceStarted(t);
    notify(t.req, 'Tarefa ' + quote(t) + ' iniciada');
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
  const end = t.start + dur * MIN;
  const clashes = allTasks().filter((o) =>
    o.emp === t.emp && o.id !== id && o.status === 'agendada' && o.start >= t.start && o.start < end);
  for (const o of clashes) await requeue(o, 'duração de outra tarefa mudou');
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

/** Devolve para "pendente" as agendadas que caíram em folga e reagenda. */
async function requeueForTimeOff(isBlocked, reason) {
  const hit = allTasks().filter((t) => t.emp === state.uid && t.status === 'agendada' && isBlocked(t));
  for (const t of hit) await requeue(t, reason);
  await scheduleWaiting(state.uid);
}

/** Momento em que a tarefa foi concluída/cancelada (pelo histórico). */
const finishedAt = (t) =>
  (t.hist || []).slice().reverse().find((h) => /Conclu|Cancel|Recus/.test(h.x))?.t || t.created;
