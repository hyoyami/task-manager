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
  openModal('<h2>' + esc(t.title) + '</h2><p>' + tag(label) + ' ' + tag(PRIORITY_LABEL[t.prio]) + '</p>'
    + '<label>Descrição atribuída</label><div>' + esc(t.desc || '—') + '</div>'
    + '<label>Solicitante → Funcionário</label><div>' + esc(nameOf(t.req)) + ' → ' + esc(nameOf(t.emp)) + '</div>'
    + '<label>Horário agendado</label><div>' + timeRange(t, 'Não chegou a ser agendada') + when(t.dur, ' · ' + t.dur + ' min') + '</div>'
    + '<label>' + label + ' em</label><div>' + fmtDateTime(finishedAt(t)) + '</div>'
    + when(t.summary, '<label>Resumo da execução</label><div>' + esc(t.summary) + '</div>')
    + '<label>Histórico</label><div class="history flat">' + historyLines(t.hist || []) + '</div>'
    + closeButton('Fechar', 'primary'));
}

/** Confirmação de conclusão, com relato (vai para o log do aparelho, se houver). */
function openCompleteTask(id) {
  const t = state.tasks[id];
  if (!t) return;
  openModal('<h2>Concluir tarefa</h2><div class="card prio-' + t.prio + '"><b>' + esc(t.title) + '</b>'
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
    + deviceLogPreview(d)
    + closeButton());
}

/** Aparelho de outra pessoa (solicitante): somente leitura. */
function openDeviceReadOnly(id) {
  const d = state.devices[id];
  if (!d) return;
  const st = deviceStatusStyle(d);
  openModal('<h2 class="title-upper">' + esc(d.name) + '</h2>'
    + '<p>' + tag(esc(d.area)) + ' ' + tag('<span class="status-dot" style="background:' + st.color + '"></span>' + st.label) + '</p>'
    + '<div class="muted">IP: ' + esc(d.ip || '—') + ' · Responsável: ' + esc(nameOf(d.owner)) + '</div>'
    + deviceLogPreview(d)
    + closeButton());
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

/** Problemas de manutenção de uma categoria (editáveis pelo funcionário). */
function openCategory(area) {
  ui.modal.category = area;
  const list = problemsOf(state.me.ws, area);
  openModal('<h2>' + categoryIcon(myCategories().find((c) => c.name === area)) + esc(area) + '</h2>'
    + '<p class="muted">Problemas de manutenção que o solicitante pode escolher ao criar uma tarefa para aparelhos desta categoria.</p>'
    + (each(list, (n, i) => '<div class="row between nowrap list-row"><span>' + esc(n) + '</span>'
      + removeButton('data-pdel="' + i + '"', 'Excluir problema') + '</div>') || '<p class="muted">Nenhum problema cadastrado.</p>')
    + '<label>Novo problema</label><div class="row nowrap"><input type="text" id="pb_n" class="grow" placeholder="Ex.: Atolamento de papel">'
    + '<button class="primary" id="pb_add">Adicionar</button></div>'
    + closeButton());
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
