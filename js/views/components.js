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
const isOpenTask = (t) => !!t.pool && !t.emp;
const statusTags = (t) => tag(isOpenTask(t) && t.status !== 'programada' ? 'Aberta para a equipe' : STATUS_LABEL[t.status])
  + ' ' + tag(PRIORITY_LABEL[t.prio]) + when(t.dev, ' ' + tag('Manutenção'))
  + (t.rec ? ' ' + tag('Periódica · ' + recurrenceLabel(t.rec)) : '');

/** Nome e categoria atuais do aparelho da tarefa (ou os gravados nela, se o aparelho foi excluído). */
function taskDevice(t) {
  if (!t.dev && !t.devName) return null;
  const d = state.devices[t.dev];
  return { name: d?.name || t.devName || '', area: d?.area || t.devArea || '', ip: d?.ip || t.devIp || '' };
}

/** Aparelho em evidência, logo abaixo do título (ícone da categoria + nome em negrito). */
function deviceChip(t) {
  const dev = taskDevice(t);
  if (!dev) return '';
  return '<div class="dev-chip">' + categoryIcon(categoryByName(dev.area)) + '<b>' + esc(dev.name) + '</b>'
    + when(dev.area, '<span class="dev-chip-area">' + esc(dev.area) + '</span>') + '</div>';
}

/** Detalhes do aparelho (o nome já aparece em destaque no deviceChip). */
function deviceLine(t) {
  const dev = taskDevice(t);
  if (!dev || (!dev.ip && !t.preset)) return '';
  return '<div class="muted">' + [dev.ip && 'IP ' + esc(dev.ip), t.preset && 'Problema: ' + esc(t.preset)].filter(Boolean).join(' · ') + '</div>';
}

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
function taskButtons(t, canControl, { withHistory = true } = {}) {
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
  if (mine && (occupying || t.status === 'pendente' || t.status === 'programada' || (!canControl && t.status === 'aguardando'))) {
    b += actionButton('cancelar', t.id, 'Cancelar', 'danger');
  }
  if (canControl && t.preset && t.devArea && !FINISHED.includes(t.status)) {
    b += '<button class="small" data-tut="' + esc(t.devArea + '||' + t.preset) + '">Ver tutorial</button>';
  }
  return b + when(withHistory, '<button class="small" data-h="' + t.id + '">Histórico</button>');
}

/**
 * Cartão de tarefa.
 * @param {object} t tarefa
 * @param {object} opt canControl: é o funcionário responsável;
 *                     draggable: cartão agendado pode ser arrastado na agenda.
 */
/**
 * Topo do cartão: horário de início e previsão de término (início + duração, então
 * acompanha o +15/−15 min). Sem horário ainda: "Horário a definir".
 */
function taskTimeHeader(t) {
  const left = t.worked && !FINISHED.includes(t.status) ? remainingMin(t) : 0;
  const dur = when(t.dur, '<span class="tt-dur">' + (left ? 'faltam ' + left + ' de ' + t.dur : t.dur) + ' min</span>');
  if (t.status === 'programada') {
    return '<div class="task-time"><span class="tt-item"><span class="tt-label">Próxima manutenção</span><b>'
      + new Date(t.want).toLocaleDateString('pt-BR') + '</b></span>' + dur + '</div><hr class="card-sep">';
  }
  if (!t.start || !t.dur) return '<div class="task-time"><span class="tt-none">Horário a definir</span>' + dur + '</div><hr class="card-sep">';
  const done = t.status === 'concluida';
  const item = (label, ms) => '<span class="tt-item"><span class="tt-label">' + label + '</span><b>' + fmtTime(ms) + '</b></span>';
  const startLabel = t.status === 'pausada' ? 'Restante reservado' : t.status === 'andamento' ? (t.resumedAt ? 'Retomada' : 'Iniciada')
    : done ? 'Iniciada' : 'Início';
  return '<div class="task-time">' + item(startLabel, t.start)
    + '<span class="tt-arrow" aria-hidden="true">→</span>'
    + item(done ? 'Término' : 'Previsão de término', taskEnd(t)) + dur + '</div>'
    + '<hr class="card-sep">';
}

function taskCard(t, { canControl = false, draggable = false } = {}) {
  const drag = draggable && canControl && t.status === 'agendada';
  const moved = t.initial && t.start && t.initial !== t.start;
  // Quem executa vê quem pediu; quem pediu vê quem executa; os demais (agenda de outro) veem os dois.
  const who = canControl ? 'de ' + nameOf(t.req)
    : isOpenTask(t) ? 'aberta para a equipe' + (t.cat ? ' (' + t.cat + ')' : '')
      : t.req === state.uid ? 'para ' + nameOf(t.emp) : 'de ' + nameOf(t.req) + ' para ' + nameOf(t.emp);
  return '<div class="card prio-' + t.prio + when(t.status === 'andamento', ' running') + '" data-tid="' + t.id + '">'
    + taskTimeHeader(t)
    + '<div class="row between' + when(drag, ' drag-row') + '"><b>' + when(drag, GRIP) + esc(t.title) + '</b><span>' + statusTags(t) + '</span></div>'
    + deviceChip(t)
    + when(t.desc, '<div class="muted">' + esc(t.desc) + '</div>')
    + deviceLine(t)
    + '<div class="muted">' + (t.start ? fmtDay(t.start) : 'Sem horário') + ' · ' + (t.dur ? t.dur + ' min' : 'duração a definir') + ' · ' + esc(who) + '</div>'
    + when(moved, '<div class="muted">Horário inicial: ' + fmtDayTime(t.initial) + '</div>')
    + when(t.summary, '<div class="muted"><b>Resumo:</b> ' + esc(t.summary) + '</div>')
    + '<div class="row actions">' + taskButtons(t, canControl) + '</div>'
    + when(ui.openHistory[t.id], '<div class="history">' + historyLines(t.hist || []) + '</div>')
    + '</div>';
}

/** Cartão compacto (faixa "Tarefas para agendar") que pode ser arrastado. */
/**
 * Alça de arrastar do cartão de tarefa. No toque, só ela arrasta (o resto do cartão rola a faixa/página);
 * com o mouse, a linha do título inteira (.drag-row) também serve.
 */
const GRIP = '<span class="drag-handle" title="Arrastar para um horário" aria-hidden="true">⠿</span> ';

const dragCard = (t) => '<div class="card prio-' + t.prio + when(ui.selectedTask === t.id, ' selected') + '" data-tid="' + t.id + '">'
  + taskTimeHeader(t)
  + '<div class="row between drag-row"><b>' + GRIP + esc(t.title) + '</b>' + tag(PRIORITY_LABEL[t.prio]) + '</div>'
  + deviceChip(t)
  + when(t.desc, '<div class="muted">' + esc(t.desc) + '</div>')
  + deviceLine(t)
  + '<div class="muted">de ' + esc(nameOf(t.req)) + '</div>'
  + '<div class="row mt-6">' + durationSelect(t) + actionButton('aceitar', t.id, 'Aceitar', 'primary') + actionButton('recusar', t.id, 'Recusar', 'danger') + '</div>'
  + '</div>';

/**
 * Tarefa aberta para a equipe, vista por quem pode assumi-la: escolhe a duração e aceita
 * (o primeiro que aceitar fica com ela).
 */
function openTaskCard(t) {
  const minutes = ui.poolDur[t.id] || 0;
  const options = each(DURATION_OPTIONS, (v) => '<option value="' + v + '"' + when(minutes === v, ' selected') + '>' + v + ' min</option>');
  return '<div class="card prio-' + t.prio + ' open-task" data-tid="' + t.id + '">'
    + taskTimeHeader(t)
    + '<div class="row between"><b>' + esc(t.title) + '</b>' + tag(PRIORITY_LABEL[t.prio]) + '</div>'
    + deviceChip(t)
    + '<div class="row gap-sm mt-6">' + tag('Aberta para a equipe') + when(t.cat, ' ' + tag(esc(t.cat))) + '</div>'
    + when(t.desc, '<div class="muted mt-6">' + esc(t.desc) + '</div>')
    + deviceLine(t)
    + '<div class="muted">de ' + esc(nameOf(t.req)) + '</div>'
    + '<div class="row mt-6"><select class="psel inline" data-i="' + t.id + '"><option value="">Duração…</option>' + options + '</select>'
    + '<button class="small primary" data-claim="' + t.id + '">Aceitar</button></div>'
    + '</div>';
}

/** Linha da aba Tarefas › Histórico (abre detalhes ao tocar). */
const finishedRow = (t) => '<div class="card clickable prio-' + t.prio + '" data-open="' + t.id + '">'
  + '<div class="row between"><b>' + esc(t.title) + '</b>' + tag(STATUS_LABEL[t.status]) + '</div>'
  + deviceChip(t)
  + '<div class="muted">' + fmtDateTime(finishedAt(t)) + ' · '
  + esc(t.emp === state.uid ? 'de ' + nameOf(t.req) : 'para ' + nameOf(t.emp)) + '</div></div>';

// ---------- Aparelhos ----------
const deviceStatusStyle = (d) => DEVICE_STATUS_STYLE[d.status] || DEVICE_STATUS_STYLE.Operacional;

/**
 * Cartão de aparelho. `own`: o usuário é o responsável (abre edição de log e pode arrastar).
 */
function deviceCard(d, own) {
  const st = deviceStatusStyle(d);
  // Alerta de manutenção periódica: só na Área de Trabalho.
  const alerts = ui.tab === 'workstation' ? periodicAlerts(d) : [];
  const late = alerts.some((a) => a.late);
  return '<div class="device-card' + when(own, ' draggable') + when(alerts.length, ' has-alert') + when(late, ' late') + '" data-did="' + d.id + '">'
    + when(own, '<span class="dv-handle" title="Arrastar para organizar" aria-hidden="true">⠿</span>')
    + when(alerts.length, '<span class="alert-ping" aria-hidden="true"></span>')
    + '<div class="device-name">' + esc(d.name) + '</div>'
    + '<div class="device-icon">' + categoryIconLarge(categoryOfDevice(d)) + '</div>'
    + '<div class="device-ip">IP: ' + esc(d.ip || '—') + '</div>'
    + '<div class="device-status">status: ' + st.label
    + ' <span class="status-dot" style="background:' + st.color + ';box-shadow:0 0 8px ' + st.color + '"></span></div>'
    + '<div class="muted device-meta">' + esc(d.area) + '</div>'
    + each(alerts, (a) => '<div class="device-alert" role="status"><b>Aviso:</b> ' + esc(a.prob) + ' — ' + alertText(a) + '</div>')
    + '<div class="row device-actions"><button class="small" ' + (own ? 'data-dev' : 'data-rodev') + '="' + d.id + '">'
    + (own ? 'Abrir / Log' : 'Ver log') + '</button>'
    + when(own, '<button class="small" data-devedit="' + d.id + '" aria-label="Editar dados do aparelho">✎ Editar</button>')
    + '</div></div>';
}

const emptyCard = (text, center = false) => '<div class="card muted' + when(center, ' empty') + '">' + text + '</div>';
