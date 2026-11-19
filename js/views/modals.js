/* ==========================================================================
   Modais. Todos reutilizam #md (fundo) e #mdb (caixa).
   O botão #dn_no fecha qualquer modal; tocar no fundo também fecha.
   ========================================================================== */
'use strict';

function openModal(html, { wide = false } = {}) {
  const box = $('#mdb');
  box.classList.toggle('wide', wide);
  box.innerHTML = html;
  $('#md').classList.add('open');
}

function closeModal() {
  $('#mdb').classList.remove('wide');
  $('#md').classList.remove('open');
  ui.modal.doneTaskId = null;
}

// ---------- Tarefas ----------
function openNewTask() {
  openModal(newTaskForm() + closeButton('Cancelar'), { wide: true });
}

/** Detalhes de tarefa concluída/cancelada (aba Tarefas › Histórico). */
function openTaskInfo(id) {
  const t = state.tasks[id];
  if (!t) return;
  const label = STATUS_LABEL[t.status];
  openModal('<h2>' + esc(t.title) + '</h2>' + deviceChip(t) + '<p>' + tag(label) + ' ' + tag(PRIORITY_LABEL[t.prio]) + '</p>'
    + '<label>Descrição atribuída</label><div>' + esc(t.desc || '—') + '</div>'
    + '<label>Solicitante → Funcionário</label><div>' + esc(nameOf(t.req)) + ' → ' + esc(nameOf(t.emp)) + '</div>'
    + '<label>Horário agendado</label><div>' + timeRange(t, 'Não chegou a ser agendada') + when(t.dur, ' · ' + t.dur + ' min') + '</div>'
    + '<label>' + label + ' em</label><div>' + fmtDateTime(finishedAt(t)) + '</div>'
    + when(t.summary, '<label>Resumo da execução</label><div>' + esc(t.summary) + '</div>')
    + when(t.ot, '<label>Hora extra</label><div>' + fmtDuration((t.ot || 0) * MIN) + ' fora do expediente</div>')
    + '<label>Histórico</label><div class="history flat">' + historyLines(t.hist || []) + '</div>'
    + closeButton('Fechar', 'primary'));
}

/** Confirmação de conclusão, com relato (vai para o log do aparelho, se houver). */
function openCompleteTask(id) {
  const t = state.tasks[id];
  if (!t) return;
  openModal('<h2>Concluir tarefa</h2><div class="card prio-' + t.prio + '"><b>' + esc(t.title) + '</b>' + deviceChip(t)
    + '<div class="muted">' + esc(t.desc || '') + '</div>'
    + '<div class="muted">' + when(t.start, timeRange(t) + ' · ') + t.dur + ' min · de ' + esc(nameOf(t.req)) + '</div></div>'
    + '<label>' + (t.dev ? 'Relato da manutenção (vai para o log do aparelho)' : 'Resumo da tarefa — como foi a execução?') + '</label>'
    + '<textarea id="dn_t" rows="4" placeholder="Explique como foi a tarefa…"></textarea>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button><button class="primary" id="dn_ok">Concluir</button></div>');
  ui.modal.doneTaskId = id;
  setTimeout(() => $('#dn_t')?.focus(), 50);
}

// ---------- Aparelhos ----------
/** Aparelho próprio: alterar status e registrar no log. */
function openDevice(id) {
  const d = state.myDevices[id];
  if (!d) return;
  const details = [d.ip && 'IP: ' + d.ip, d.code && 'Código: ' + d.code, d.loc && 'Local: ' + d.loc].filter(Boolean).join(' · ');
  openModal('<h2>' + esc(d.name) + '</h2><p>' + tag(esc(d.area)) + '</p>'
    + '<div class="muted">' + esc(details || 'Sem detalhes adicionais') + '</div>'
    + '<label>Status</label><select class="dv_st" data-i="' + id + '">'
    + each(DEVICE_STATUSES, (s) => '<option' + when(s === d.status, ' selected') + '>' + s + '</option>') + '</select>'
    + '<label>Registrar no log</label><textarea id="dv_t" rows="2" placeholder="Ex.: troca de toner, formatação, cabo substituído…"></textarea>'
    + '<p><button class="small primary" data-lg="' + id + '">Registrar</button></p>'
    + recurringOfDevice(d)
    + deviceLogPreview(d)
    + when(canDeleteDevice(d), '<p><button class="small danger" data-devdel="' + d.id + '">Excluir aparelho</button></p>')
    + closeButton());
}

/** Editar dados do aparelho (nome, IP e categoria) e excluir. */
function openDeviceEdit(id) {
  const d = state.devices[id];
  if (!d) return;
  ui.modal.deviceEdit = id;
  // Funcionário: só as categorias da sua função (senão o aparelho sumiria da Área de Trabalho dele).
  const cats = myCategories();
  if (!cats.some((c) => c.name === d.area)) cats.push({ name: d.area });
  openModal('<h2>Editar aparelho</h2>'
    + '<label for="de_n">Nome</label><input type="text" id="de_n" maxlength="60" value="' + esc(d.name) + '">'
    + '<label for="de_i">IP</label><input type="text" id="de_i" inputmode="decimal" value="' + esc(d.ip || '') + '" placeholder="Ex.: 192.168.0.25">'
    + '<label for="de_a">Categoria</label><select id="de_a">'
    + each(cats, (c) => '<option' + when(c.name === d.area, ' selected') + '>' + esc(c.name) + '</option>') + '</select>'
    + '<p class="muted">As alterações ficam registradas no log do aparelho.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button><button class="primary" id="de_ok">Salvar</button></div>'
    + '<div class="danger-zone card mt-12"><b>Excluir aparelho</b>'
    + (canDeleteDevice(d)
      ? '<p class="muted">Apaga o aparelho e todo o log dele. Não dá para desfazer.</p>'
        + '<p class="mb-0"><button class="small danger" data-devdel="' + d.id + '">Excluir aparelho</button></p>'
      : '<p class="muted mb-0">Só quem cadastrou (' + esc(nameOf(d.owner)) + ') ou o administrador pode excluir.</p>')
    + '</div>');
  setTimeout(() => $('#de_n')?.focus(), 50);
}

/** Confirmação antes de excluir o aparelho. */
function openDeviceDeleteConfirm(id) {
  const d = state.devices[id];
  if (!d) return;
  ui.modal.deviceDelete = id;
  const open = allTasks().filter((t) => t.dev === id && !FINISHED.includes(t.status)).length;
  openModal('<h2>Excluir aparelho?</h2>'
    + '<p>O aparelho <b>' + esc(d.name) + '</b> (' + esc(d.area) + ' · IP ' + esc(d.ip || '—') + ') e todo o log dele serão apagados.</p>'
    + when(open, '<p class="muted">Há ' + plural(open, 'tarefa aberta ligada', 'tarefas abertas ligadas') + ' a ele; elas continuam, sem o aparelho.</p>')
    + '<p class="muted">Não dá para desfazer.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button>'
    + '<button class="primary delete-solid" id="dx_ok">Excluir</button></div>');
}

/** Aparelho visto pelo solicitante (ou de categoria fora da função): dados e log; só acrescenta anotações. */
function openDeviceReadOnly(id) {
  const d = state.devices[id];
  if (!d) return;
  const st = deviceStatusStyle(d);
  openModal('<h2 class="title-upper">' + esc(d.name) + '</h2>'
    + '<p>' + tag(esc(d.area)) + ' ' + tag('<span class="status-dot" style="background:' + st.color + '"></span>' + st.label) + '</p>'
    + '<div class="muted">IP: ' + esc(d.ip || '—') + ' · Responsável: ' + esc(nameOf(d.owner)) + '</div>'
    + recurringOfDevice(d)
    + '<label for="rl_t">Registrar no log</label>'
    + '<textarea id="rl_t" rows="2" maxlength="1000" placeholder="Ex.: impressora fazendo barulho, papel acabou, luz piscando…"></textarea>'
    + '<p class="muted mb-0">Fica no histórico do aparelho, com o seu nome, para toda a equipe.</p>'
    + '<p><button class="small primary" data-rlg="' + id + '">Registrar</button></p>'
    + deviceLogPreview(d)
    + closeButton());
}

/** Manutenções periódicas em aberto do aparelho (próxima data e intervalo). */
function recurringOfDevice(d) {
  const list = allTasks().filter((t) => t.dev === d.id && t.rec && !FINISHED.includes(t.status));
  const alerts = periodicAlerts(d);
  const warn = when(alerts.length, '<label>Avisos</label>' + each(alerts, (a) => '<div class="device-alert">'
    + '<b>' + esc(a.prob) + '</b> (' + recurrenceLabel(a.rec) + ') — ' + alertText(a)
    + '. Nenhuma tarefa marcada: abra uma em Nova tarefa.</div>'));
  if (!list.length) return warn;
  const when_ = (t) => (t.status === 'programada' ? 'próxima em ' + new Date(t.want).toLocaleDateString('pt-BR')
    : t.start ? STATUS_LABEL[t.status].toLowerCase() + ' · ' + fmtDayTime(t.start) : STATUS_LABEL[t.status].toLowerCase());
  return warn + '<label>Manutenções periódicas</label><div class="history">'
    + each(list, (t, i) => when(i, '<br>') + '<b>' + esc(t.preset || t.title) + '</b> — ' + recurrenceLabel(t.rec) + ' · ' + when_(t))
    + '</div>';
}

// ---------- Log do aparelho ----------
const LOG_PREVIEW_SIZE = 5;

/** Últimos registros do log (mais recentes primeiro) + botão "+log" para o histórico completo. */
function deviceLogPreview(d) {
  const log = (d.log || []).slice().reverse();
  const shown = log.slice(0, LOG_PREVIEW_SIZE);
  return '<div class="row between log-head"><label>Histórico de log'
    + when(log.length > LOG_PREVIEW_SIZE, ' <span class="muted">(' + shown.length + ' de ' + log.length + ')</span>') + '</label>'
    + '<button class="small" data-fulllog="' + d.id + '" aria-label="Ver log completo">+log</button></div>'
    + '<div class="history log">' + (historyLines(shown) || 'Sem registros.') + '</div>';
}

/** Tipo do registro, deduzido do texto (os registros antigos não guardam o tipo). */
function logEntryKind(text) {
  if (/^Status:/.test(text)) return 'Status';
  if (/^Anotação:/.test(text)) return 'Anotação';
  if (/^Manutenção/.test(text)) return 'Manutenção';
  if (/^Aparelho cadastrado/.test(text)) return 'Cadastro';
  return 'Registro';
}

/** Histórico completo do log, detalhado (data, hora, tipo e descrição). */
function openDeviceLog(id) {
  const d = state.devices[id];
  if (!d) return;
  const own = d.owner === state.uid;
  const log = (d.log || []).slice().reverse();
  const date = (ms) => new Date(ms).toLocaleDateString('pt-BR');
  const time = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const row = (h, i) => '<div class="log-row">'
    + '<div class="log-when"><b>' + date(h.t) + '</b><span>' + time(h.t) + '</span><span class="muted">#' + (log.length - i) + '</span></div>'
    + '<div class="log-body">' + tag(logEntryKind(h.x)) + '<div class="pre-wrap">' + esc(h.x) + '</div></div></div>';

  openModal('<h2>Log — ' + esc(d.name) + '</h2>'
    + '<p class="muted">' + esc(d.area) + ' · IP ' + esc(d.ip || '—') + ' · Responsável: ' + esc(nameOf(d.owner))
    + ' · Status atual: ' + esc(d.status || 'Operacional') + ' · ' + plural(log.length, 'registro', 'registros') + '</p>'
    + (each(log, row) || emptyCard('Sem registros.'))
    + '<div class="row between mt-12"><button class="small" ' + (own ? 'data-dev' : 'data-rodev') + '="' + d.id + '">← Voltar</button>'
    + '<button id="dn_no">Fechar</button></div>', { wide: true });
}

/** Problemas de manutenção de uma categoria (editados pelo administrador, na aba Empresa). */
function openCategory(area) {
  ui.modal.category = area;
  const list = problemsOf(area);
  openModal('<h2>' + categoryIcon(categoryByName(area)) + esc(area) + '</h2>'
    + '<p class="muted">Problemas de manutenção que o solicitante pode escolher ao criar uma tarefa para aparelhos desta categoria.</p>'
    + (each(list, (n, i) => {
      const rec = problemRecurrence(area, n);
      return '<div class="row between nowrap list-row"><span>' + esc(n)
        + (rec ? ' <span class="muted">· aviso ' + recurrenceLabel(rec) + '</span>' : '') + '</span>'
        + '<span class="row nowrap gap-sm"><button class="small" data-pedit="' + i + '">Editar</button>'
        + removeButton('data-pdel="' + i + '"', 'Excluir problema') + '</span></div>';
    }) || '<p class="muted">Nenhum problema cadastrado.</p>')
    + '<label>Novo problema</label><div class="row nowrap"><input type="text" id="pb_n" class="grow" placeholder="Ex.: Atolamento de papel">'
    + '<button class="primary" id="pb_add">Adicionar</button></div>'
    + closeButton());
}

/** Editar um problema da categoria: nome e aviso periódico padrão. */
function openProblemEdit(area, index) {
  const name = problemsOf(area)[index];
  if (name === undefined) return;
  ui.modal.category = area;
  ui.modal.problemIndex = index;
  openModal('<h2>Editar problema</h2><p class="muted">' + categoryIcon(categoryByName(area)) + esc(area) + '</p>'
    + '<label for="pb_en">Nome do problema</label><input type="text" id="pb_en" maxlength="60" value="' + esc(name) + '">'
    + recurrenceFields('pb', problemRecurrence(area, name))
    + '<p class="muted">Com aviso, ao escolher este problema na Nova tarefa a manutenção periódica já vem marcada com este intervalo.</p>'
    + '<div class="row between mt-12"><button data-cat="' + esc(area) + '">← Voltar</button>'
    + '<button class="primary" id="pb_save">Salvar</button></div>');
  setTimeout(() => $('#pb_en')?.focus(), 50);
}

function openCategoryDelete(name) {
  ui.modal.categoryToDelete = name;
  const n = Object.values(state.myDevices).filter((d) => d.area === name).length;
  openModal('<h2>Excluir categoria</h2><p>Deseja excluir a categoria <b>' + esc(name) + '</b>?</p>'
    + (n ? '<p class="muted">Os <b>' + n + '</b> aparelho(s) desta categoria, com seus logs, também serão excluídos.</p>'
      : '<p class="muted">Nenhum aparelho cadastrado nesta categoria.</p>')
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button>'
    + '<button class="primary delete-solid" id="cd_ok">Excluir</button></div>');
}

// ---------- Tutoriais ----------
function openTutorial(cat, prob) {
  ui.modal.tutorial = [cat, prob];
  const steps = tutorialSteps(cat, prob);
  const editable = isEmployee();
  const stepCard = (x, i) => '<div class="card"><div class="row between nowrap"><b>Passo ' + (i + 1) + '</b>'
    + when(editable, '<span class="row nowrap gap-sm">'
      + '<button class="small" data-tmv="' + x.id + '|-1" aria-label="Subir passo">▲</button>'
      + '<button class="small" data-tmv="' + x.id + '|1" aria-label="Descer passo">▼</button>'
      + '<button class="small danger" data-tdel="' + x.id + '" aria-label="Excluir passo">✕</button></span>')
    + '</div>'
    + when(isDataUrl(x.img), '<img class="step-img" src="' + esc(x.img) + '" alt="">')
    + '<div class="pre-wrap">' + esc(x.txt) + '</div></div>';

  openModal('<h2>' + esc(prob) + '</h2><p class="muted">' + esc(cat) + '</p>'
    + (each(steps, stepCard) || emptyCard('Ainda não há tutorial para este problema.' + when(editable, ' Adicione o primeiro passo abaixo.')))
    + when(editable, '<div class="card"><b>Novo passo</b><label>Foto (opcional)</label><input type="file" id="tu_f" accept="image/*">'
      + '<label>Descrição do passo</label><textarea id="tu_t" rows="3"></textarea>'
      + '<p><button class="primary" id="tu_add">Adicionar passo</button></p></div>')
    + closeButton(), { wide: true });
}

const reopenTutorial = () => openTutorial(...ui.modal.tutorial);

// ---------- Grupos de aparelhos ----------
/** Renomear grupo. `isNew`: acabou de ser criado ao soltar um aparelho sobre outro. */
function openGroupRename(groupId, isNew = false) {
  const group = findGroup(state.uid, groupId);
  if (!group) return;
  ui.modal.group = groupId;
  openModal('<h2>' + (isNew ? 'Grupo criado' : 'Renomear grupo') + '</h2>'
    + when(isNew, '<p class="muted">Dê um nome para o novo grupo de aparelhos.</p>')
    + '<label for="gr_n">Nome do grupo</label><input type="text" id="gr_n" maxlength="40" value="' + esc(group.name) + '">'
    + '<div class="row between mt-12"><button id="dn_no">' + (isNew ? 'Manter nome' : 'Cancelar') + '</button>'
    + '<button class="primary" id="gr_ok">Salvar</button></div>');
  setTimeout(() => { const input = $('#gr_n'); input?.focus(); input?.select(); }, 50);
}

/** Iniciar fora do expediente: só com confirmação (a tarefa entra na agenda de hoje, fora do horário). */
function openStartOutsideHours(id, action = 'iniciar') {
  const t = state.tasks[id];
  if (!t) return;
  const p = profileOf(t.emp);
  const verb = action === 'retomar' ? 'Retomar' : 'Iniciar';
  ui.modal.startTaskId = id;
  ui.modal.startAction = action;
  openModal('<h2>' + verb + ' fora do expediente?</h2>'
    + '<p>Seu horário de trabalho é <b>' + esc(p.start) + '–' + esc(p.end) + '</b> e agora são <b>' + fmtTime(Date.now()) + '</b>'
    + (isOutsideWorkHours({ ...p, start: '00:00', end: '23:59' }, Date.now()) ? ' (dia de folga ou feriado)' : '') + '.</p>'
    + '<div class="card prio-' + t.prio + '"><b>' + esc(t.title) + '</b>' + deviceChip(t)
    + '<div class="muted">' + (t.start ? 'Agendada para ' + fmtDayTime(t.start) : 'Sem horário') + when(t.dur, ' · ' + t.dur + ' min') + '</div></div>'
    + '<p class="muted">Se ' + verb.toLowerCase() + ' agora, ela sai desse horário e entra na agenda de hoje, fora do expediente.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button>'
    + '<button class="primary" id="so_ok">' + verb + ' agora</button></div>');
}

// ---------- Intervalo sob demanda ----------
/** Nomes sugeridos e a duração padrão de cada um (minutos). */
const BREAK_PRESETS = { 'Almoço': 60, 'Café': 15, 'Saída rápida': 30 };
const BREAK_DURATIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function openBreakDialog() {
  const running = allTasks().find((t) => t.emp === state.uid && t.status === 'andamento');
  openModal('<h2>Iniciar intervalo</h2>'
    + '<label for="br_n">Nome do intervalo</label><input type="text" id="br_n" maxlength="40" placeholder="Ex.: Almoço">'
    + '<div class="row gap-sm mt-6">' + each(Object.keys(BREAK_PRESETS), (n) => '<button type="button" class="small" data-brn="' + esc(n) + '">' + esc(n) + '</button>') + '</div>'
    + '<label for="br_m">Duração</label><select id="br_m">'
    + each(BREAK_DURATIONS, (m) => '<option value="' + m + '"' + when(m === 30, ' selected') + '>' + (m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '')) + '</option>')
    + '</select>'
    + (running ? '<p class="muted">A tarefa em andamento <b>' + esc(running.title) + '</b> será pausada; o que falta dela vai para logo depois do intervalo.</p>' : '')
    + '<p class="muted">As tarefas agendadas nesse tempo vão para depois, na mesma ordem.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button><button class="primary" id="br_ok">Iniciar intervalo</button></div>');
  setTimeout(() => $('#br_n')?.focus(), 50);
}

// ---------- Pausou depois do expediente ----------
function openEndOfDayPause(id) {
  const t = state.tasks[id];
  if (!t || t.status !== 'pausada') return;
  const p = profileOf(t.emp);
  const at = nextDayFirstSlot(t);
  ui.modal.nextDayTask = id;
  openModal('<h2>Seu expediente terminou</h2>'
    + '<p>Seu horário de trabalho acabou às <b>' + esc(p.end) + '</b>.</p>'
    + '<div class="card prio-' + t.prio + '"><b>' + esc(t.title) + '</b>' + deviceChip(t)
    + '<div class="muted">Pausada · ' + (t.worked || 0) + ' de ' + t.dur + ' min feitos · faltam ' + remainingMin(t) + ' min'
    + when(t.ot, ' · hora extra ' + fmtDuration(t.ot * MIN)) + '</div></div>'
    + (at ? '<p>Se não for concluir hoje, quer enviá-la para ser a <b>primeira tarefa do próximo dia de trabalho</b> — <b>'
        + esc(fmtDayTime(at)) + '</b>? O tempo já feito e o histórico ficam salvos; é só tocar em <b>Retomar</b>.</p>'
        + '<p class="muted">As tarefas desse dia vão para depois dela, na mesma ordem.</p>'
      : '<p class="muted">Não há outro dia de trabalho nesta semana da agenda; ela fica pausada e é reagendada na semana que vem.</p>')
    + '<div class="row between mt-12"><button id="dn_no">Não, deixar como está</button>'
    + when(at, '<button class="primary" id="nd_ok">Sim, enviar para o próximo dia</button>') + '</div>');
}

// ---------- Hora extra ----------
/** Lê a janela de hora extra: { s, e, note } ou { error }. */
function readOvertime() {
  const day = $('#he_d')?.value;
  const from = $('#he_s')?.value;
  const to = $('#he_e')?.value;
  if (!day || !from || !to) return { error: 'Informe o dia e o horário de início e de fim.' };
  const base = parseDateInput(day);
  const s = atTime(base, from);
  const e = atTime(base, to);
  if (e <= s) return { error: 'O fim precisa ser depois do início.' };
  if (e <= Date.now()) return { error: 'Esse horário já passou.' };
  return { s, e, note: ($('#he_n')?.value || '').trim() };
}

function openOvertime() {
  const now = Date.now();
  const p = profileOf(state.uid);
  // Padrão: a partir do fim do expediente de hoje (ou de agora, se já passou), por 1 hora.
  const endToday = atTime(startOfDay(now), p.end);
  const start = Math.max(endToday, Math.ceil(now / (5 * MIN)) * 5 * MIN);
  const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
  openModal('<h2>Programar hora extra</h2>'
    + '<p class="muted">Seu expediente: ' + esc(p.start) + '–' + esc(p.end) + '.</p>'
    + '<label for="he_d">Dia</label><input type="date" id="he_d" value="' + dateKey(start) + '" min="' + dateKey(now) + '">'
    + '<div class="grid-2"><div><label for="he_s">Início</label><input type="time" id="he_s" value="' + hhmm(start) + '"></div>'
    + '<div><label for="he_e">Fim</label><input type="time" id="he_e" value="' + hhmm(start + 60 * MIN) + '"></div></div>'
    + '<label for="he_n">Motivo (opcional)</label><input type="text" id="he_n" maxlength="60" placeholder="Ex.: fechamento do mês">'
    + '<p class="muted">As tarefas que estão esperando horário já podem ser encaixadas nesse tempo, pela urgência.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button><button class="primary" id="he_ok">Programar</button></div>');
}

// ---------- Ausência parcial ----------
const PARTIAL_ABSENCE_REASONS = ['Médico', 'Assunto pessoal', 'Banco', 'Saída rápida'];

/** Lê a janela de ausência parcial: { s, e, note } ou { error }. */
function readPartialAbsence() {
  const day = $('#pa_d')?.value;
  const from = $('#pa_s')?.value;
  const to = $('#pa_e')?.value;
  if (!day || !from || !to) return { error: 'Informe o dia e o horário de saída e de volta.' };
  const base = parseDateInput(day);
  const s = atTime(base, from);
  const e = atTime(base, to);
  if (e <= s) return { error: 'O horário de volta precisa ser depois da saída.' };
  if (e <= Date.now()) return { error: 'Esse horário já passou.' };
  return { s, e, note: ($('#pa_n')?.value || '').trim() };
}

/** Prévia das tarefas agendadas que caem no período escolhido. */
function partialAbsenceImpact() {
  const box = $('#pa_aff');
  if (!box) return;
  const r = readPartialAbsence();
  if (r.error) { box.innerHTML = '<p class="muted">' + esc(r.error) + '</p>'; return; }
  const list = scheduledInPeriod(r.s, r.e);
  const running = r.s <= Date.now() && allTasks().find((t) => t.emp === state.uid && t.status === 'andamento');
  box.innerHTML = (list.length ? '<p class="muted">Vão para depois (na mesma ordem):</p><div class="history">'
    + each(list, (t, i) => when(i, '<br>') + fmtTime(t.start) + ' — ' + esc(t.title)) + '</div>'
    : '<p class="muted">Nenhuma tarefa agendada nesse horário.</p>')
    + (running ? '<p class="muted">A tarefa em andamento <b>' + esc(running.title) + '</b> será pausada; o que falta vai para depois.</p>' : '');
}

function openPartialAbsence() {
  const now = Date.now();
  const start = Math.ceil(now / (5 * MIN)) * 5 * MIN;
  const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
  openModal('<h2>Ausência parcial</h2>'
    + '<label for="pa_d">Dia</label><input type="date" id="pa_d" value="' + dateKey(now) + '" min="' + dateKey(now) + '">'
    + '<div class="grid-2"><div><label for="pa_s">Saída</label><input type="time" id="pa_s" value="' + hhmm(start) + '"></div>'
    + '<div><label for="pa_e">Volta</label><input type="time" id="pa_e" value="' + hhmm(start + 60 * MIN) + '"></div></div>'
    + '<label for="pa_n">Motivo</label><input type="text" id="pa_n" maxlength="60" placeholder="Ex.: Médico">'
    + '<div class="row gap-sm mt-6">' + each(PARTIAL_ABSENCE_REASONS, (n) => '<button type="button" class="small" data-pan="' + esc(n) + '">' + esc(n) + '</button>') + '</div>'
    + '<div id="pa_aff" class="mt-12"></div>'
    + '<p class="muted">Quem pediu as tarefas é avisado do novo horário.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button><button class="primary" id="pa_ok">Registrar ausência</button></div>');
  partialAbsenceImpact();
}

// ---------- Ausência ----------
function openAbsentConfirm() {
  const day = startOfDay(Date.now());
  const list = scheduledOnDay(day).sort((a, b) => a.start - b.start);
  const running = allTasks().filter((t) => t.emp === state.uid && STARTED.includes(t.status));
  openModal('<h2>Marcar hoje como ausente?</h2>'
    + '<p>Hoje, <b>' + esc(new Date(day).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }))
    + '</b>, ficará como <b>ausente</b> na sua agenda. Só este dia.</p>'
    + (list.length ? '<p class="muted">Estas tarefas vão para o dia seguinte (primeiro horário livre, pela urgência):</p>'
      + '<div class="history">' + each(list, (t, i) => when(i, '<br>') + fmtTime(t.start) + ' — ' + esc(t.title)
        + when(t.dev, ' · <b>' + esc(taskDevice(t)?.name || '') + '</b>')) + '</div>'
      : '<p class="muted">Você não tem tarefas agendadas para hoje.</p>')
    + when(running.length, '<p class="muted">Tarefas já iniciadas (em andamento ou pausadas) não são movidas.</p>')
    + '<p class="muted">Quem pediu as tarefas é avisado do novo horário.</p>'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button>'
    + '<button class="primary delete-solid" id="ab_ok">Sim, estou ausente hoje</button></div>');
}

// ---------- Exclusões (irreversíveis) ----------
function openDeleteAccount() {
  openModal('<h2>Excluir minha conta</h2>'
    + '<p>Isto apaga a sua conta <b>' + esc(state.me.email || '') + '</b> de forma <b>definitiva</b>.</p>'
    + '<p class="muted">Tarefas abertas que você pediu serão canceladas; as que você executaria voltam a ficar abertas para a equipe.</p>'
    + '<label for="xa_p">Sua senha</label><input type="password" id="xa_p" autocomplete="current-password">'
    + '<label for="xa_t">Digite <b>EXCLUIR</b> para confirmar</label><input type="text" id="xa_t" autocomplete="off" autocapitalize="characters">'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button>'
    + '<button class="primary delete-solid" id="xa_ok">Excluir conta</button></div>');
}

function openDeleteCompany() {
  const name = state.company?.name || '';
  openModal('<h2>Excluir empresa</h2>'
    + '<p>Isto apaga <b>' + esc(name) + '</b> e <b>todos</b> os dados dela de forma <b>definitiva</b>.</p>'
    + '<p class="muted">Os membros continuam com a conta e voltam para a tela de entrada.</p>'
    + '<label for="xc_t">Digite o nome da empresa (<b>' + esc(name) + '</b>) para confirmar</label>'
    + '<input type="text" id="xc_t" autocomplete="off">'
    + '<label for="xc_p">Sua senha</label><input type="password" id="xc_p" autocomplete="current-password">'
    + '<div class="row between mt-12"><button id="dn_no">Cancelar</button>'
    + '<button class="primary delete-solid" id="xc_ok">Excluir empresa</button></div>');
}
