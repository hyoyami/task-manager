/* ==========================================================================
   Componentes de interface reutilizáveis. Cada função devolve uma string HTML.
   Convenção: todo texto vindo do usuário/banco passa por esc().
   ========================================================================== */
'use strict';

const avatar = (id, name, size) =>
  '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;background:' + colorFor(id) + '">'
  + esc(initial(name)) + '</span>';

/** Ícone pequeno de categoria (emoji ou imagem PNG enviada). */
const categoryIcon = (c) => (isDataUrl(c?.icon)
  ? '<img class="cat-icon" src="' + esc(c.icon) + '" alt="">'
  : esc(c?.icon || DEFAULT_CATEGORY_ICON) + ' ');

/** Ícone grande de categoria, usado no cartão do aparelho. */
const categoryIconLarge = (c) => (isDataUrl(c?.icon)
  ? '<img src="' + esc(c.icon) + '" alt="">'
  : '<span class="emoji">' + esc(c?.icon || DEFAULT_CATEGORY_ICON) + '</span>');

const tag = (html) => '<span class="tag">' + html + '</span>';

const closeButton = (label = 'Fechar', cls = '') =>
  '<p><button id="dn_no" class="block' + (cls ? ' ' + cls : '') + '">' + label + '</button></p>';

const removeButton = (attr, label) =>
  '<button class="small remove-x" ' + attr + ' aria-label="' + label + '" title="' + label + '">✕</button>';

/** Lista de entradas de histórico/log: [{t, x}]. */
const historyLines = (entries) => each(entries, (h, i) => (i ? '<br>' : '') + fmtDateTime(h.t) + ' — ' + esc(h.x));

/** "qua., 11/11 09:00–09:30" ou o texto alternativo. */
const timeRange = (t, none = 'Sem horário') =>
  (t.start ? fmtDayTime(t.start) + '–' + fmtTime(taskEnd(t)) : none);

// ---------- Tarefas ----------
const statusTags = (t) => tag(STATUS_LABEL[t.status]) + ' ' + tag(PRIORITY_LABEL[t.prio])
  + when(t.dev, ' ' + tag('Manutenção'));

const deviceLine = (t) => when(t.dev, '<div class="muted">Aparelho: ' + esc(t.devName || '')
  + when(t.devArea, ' (' + esc(t.devArea) + ')')
  + when(t.devIp, ' · IP ' + esc(t.devIp))
  + when(t.preset, ' · Tarefa: ' + esc(t.preset)) + '</div>');

function durationSelect(t) {
  const options = [...DURATION_OPTIONS];
  if (t.dur && !options.includes(t.dur)) options.push(t.dur);
  options.sort((a, b) => a - b);
  return '<select class="dsel inline" data-i="' + t.id + '"><option value="">Duração…</option>'
    + each(options, (v) => '<option value="' + v + '"' + when(t.dur === v, ' selected') + '>' + v + ' min</option>')
    + '</select>';
}

const actionButton = (action, id, label, cls = '') =>
  '<button class="small' + (cls ? ' ' + cls : '') + '" data-a="' + action + '" data-i="' + id + '">' + label + '</button>';

/** Botões de ação do cartão conforme status e papel de quem vê. */
function taskButtons(t, canControl) {
  const occupying = OCCUPYING.includes(t.status);
  let b = '';
  if (canControl && UNSCHEDULED.includes(t.status)) b += durationSelect(t);
  if (canControl && t.status === 'aguardando') {
    b += actionButton('aceitar', t.id, 'Agendar automático', 'primary') + actionButton('recusar', t.id, 'Recusar', 'danger');
  }
  if (canControl && occupying) {
    if (t.status === 'agendada') b += actionButton('iniciar', t.id, 'Iniciar', 'primary');
    if (t.status === 'andamento') b += actionButton('pausar', t.id, 'Pausar');
    if (t.status === 'pausada') b += actionButton('retomar', t.id, 'Retomar');
    if (t.status !== 'agendada') b += actionButton('concluir', t.id, 'Concluir', 'primary');
    b += '<button class="small" data-d="-15" data-i="' + t.id + '">−15 min</button>'
      + '<button class="small" data-d="15" data-i="' + t.id + '">+15 min</button>';
  }
  const mine = canControl || t.req === state.uid;
  if (mine && (occupying || t.status === 'pendente' || (!canControl && t.status === 'aguardando'))) {
    b += actionButton('cancelar', t.id, 'Cancelar', 'danger');
  }
  if (canControl && t.preset && t.devArea && !FINISHED.includes(t.status)) {
    b += '<button class="small" data-tut="' + esc(t.devArea + '||' + t.preset) + '">Ver tutorial</button>';
  }
  return b + '<button class="small" data-h="' + t.id + '">Histórico</button>';
}

/**
 * Cartão de tarefa.
 * @param {object} t tarefa
 * @param {object} opt canControl: é o funcionário responsável; masked: mostrar só "Ocupado";
 *                     draggable: cartão agendado pode ser arrastado na agenda.
 */
function taskCard(t, { canControl = false, masked = false, draggable = false } = {}) {
  if (masked) {
    return '<div class="card"><b>Ocupado</b> <span class="muted">' + fmtTime(t.start) + '–' + fmtTime(taskEnd(t)) + '</span></div>';
  }
  const drag = draggable && canControl && t.status === 'agendada';
  const moved = t.initial && t.start && t.initial !== t.start;
  const who = canControl ? 'de ' + nameOf(t.req) : 'para ' + nameOf(t.emp);
  return '<div class="card prio-' + t.prio + '" data-tid="' + t.id + '">'
    + '<div class="row between' + when(drag, ' drag-handle') + '"><b>' + when(drag, '⠿ ') + esc(t.title) + '</b><span>' + statusTags(t) + '</span></div>'
    + when(t.desc, '<div class="muted">' + esc(t.desc) + '</div>')
    + deviceLine(t)
    + '<div class="muted">' + timeRange(t) + ' · ' + (t.dur ? t.dur + ' min' : 'duração a definir') + ' · ' + esc(who) + '</div>'
    + when(moved, '<div class="muted">Horário inicial: ' + fmtDayTime(t.initial) + '</div>')
    + when(t.summary, '<div class="muted"><b>Resumo:</b> ' + esc(t.summary) + '</div>')
    + '<div class="row actions">' + taskButtons(t, canControl) + '</div>'
    + when(ui.openHistory[t.id], '<div class="history">' + historyLines(t.hist || []) + '</div>')
    + '</div>';
}

/** Cartão compacto (faixa "Tarefas para agendar") que pode ser arrastado. */
const dragCard = (t) => '<div class="card prio-' + t.prio + when(ui.selectedTask === t.id, ' selected') + '" data-tid="' + t.id + '">'
  + '<div class="row between drag-handle"><b>⠿ ' + esc(t.title) + '</b>' + tag(PRIORITY_LABEL[t.prio]) + '</div>'
  + when(t.desc, '<div class="muted">' + esc(t.desc) + '</div>')
  + deviceLine(t)
  + '<div class="muted">de ' + esc(nameOf(t.req)) + '</div>'
  + '<div class="row mt-6">' + durationSelect(t) + actionButton('aceitar', t.id, 'Auto') + actionButton('recusar', t.id, 'Recusar', 'danger') + '</div>'
  + '</div>';

/** Linha da aba Tarefas › Histórico (abre detalhes ao tocar). */
const finishedRow = (t) => '<div class="card clickable prio-' + t.prio + '" data-open="' + t.id + '">'
  + '<div class="row between"><b>' + esc(t.title) + '</b>' + tag(STATUS_LABEL[t.status]) + '</div>'
  + '<div class="muted">' + fmtDateTime(finishedAt(t)) + ' · '
  + esc(isEmployee() ? 'de ' + nameOf(t.req) : 'para ' + nameOf(t.emp)) + '</div></div>';

// ---------- Aparelhos ----------
const deviceStatusStyle = (d) => DEVICE_STATUS_STYLE[d.status] || DEVICE_STATUS_STYLE.Operacional;

/**
 * Cartão de aparelho. `own`: o usuário é o responsável (abre edição de log e pode arrastar).
 */
function deviceCard(d, own) {
  const st = deviceStatusStyle(d);
  return '<div class="device-card' + when(own, ' draggable') + '" data-did="' + d.id + '">'
    + when(own, '<span class="dv-handle" title="Arrastar para organizar" aria-hidden="true">⠿</span>')
    + '<div class="device-name">' + esc(d.name) + '</div>'
    + '<div class="device-icon">' + categoryIconLarge(categoryOfDevice(d)) + '</div>'
    + '<div class="device-ip">IP: ' + esc(d.ip || '—') + '</div>'
    + '<div class="device-status">status: ' + st.label
    + ' <span class="status-dot" style="background:' + st.color + ';box-shadow:0 0 8px ' + st.color + '"></span></div>'
    + '<div class="muted device-meta">' + esc(d.area) + ' · ' + esc(nameOf(d.owner)) + '</div>'
    + '<button class="small" ' + (own ? 'data-dev' : 'data-rodev') + '="' + d.id + '">'
    + (own ? 'Abrir / Log' : 'Ver log') + ' (' + (d.log || []).length + ')</button></div>';
}

const emptyCard = (text, center = false) => '<div class="card muted' + when(center, ' empty') + '">' + text + '</div>';
