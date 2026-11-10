/* ==========================================================================
   Ações disparadas por botões.

   ACTIONS_BY_ID      → botões identificados por id (formulários, modais).
   ACTIONS_BY_DATA    → botões com atributo data-* (listas; o valor vem do atributo).
   O despacho fica em app/events.js.
   ========================================================================== */
'use strict';

/** Atualiza o perfil logado localmente (otimista) e no banco. */
async function patchMyProfile(patch) {
  state.profiles[state.uid] = { ...state.profiles[state.uid], ...patch };
  state.me = state.profiles[state.uid];
  await updateMyProfile(patch);
}

// ---------- Workstation ----------
async function saveCargo() {
  const cargo = $('#w_c').value;
  if (!cargo) return say('Selecione o cargo.');
  // Recomeça a configuração com as categorias sugeridas para o cargo.
  await updateMyProfile({ ws: { cargo, cats: CARGOS[cargo].cats.map((c) => ({ ...c, id: c.name })), setup: false, s1: true } });
  ui.wsStep = 'dev';
}

async function finishSetup() {
  const skip = $('#w_skip')?.checked;
  if (!Object.keys(state.myDevices).length && !skip) return say('Adicione um aparelho ou marque “Não adicionar aparelhos”.');
  await updateWorkstation({ setup: true });
  ui.wsStep = 'dev';
}

async function submitDevice() {
  const name = $('#dv_n').value.trim();
  const ip = $('#dv_i').value.trim();
  if (!name) return say('Informe o nome do aparelho.');
  if (!isValidIp(ip)) return say('Informe um IP válido (ex.: 192.168.0.25).');
  await createDevice({ name, ip, area: $('#dv_a').value });
  ui.wsStep = 'dev';
  say('Aparelho cadastrado.');
  render();
}

async function submitCategory() {
  const name = $('#wc_n').value.trim();
  const file = $('#wc_f').files[0];
  if (!name) return say('Informe o nome da categoria.');
  if (!file || file.type !== 'image/png') return say('Envie o ícone em PNG.');
  if (myCategories().some((c) => c.name.toLowerCase() === name.toLowerCase())) return say('Essa categoria já existe.');
  const icon = await readIcon(file);
  await updateWorkstation({
    cats: [...myCategories(), { id: name, name, icon }],
    hidden: (state.me.ws?.hidden || []).filter((h) => h !== name),
  });
  say('Categoria adicionada.');
}

async function confirmCategoryDelete() {
  const name = ui.modal.categoryToDelete;
  ui.modal.categoryToDelete = null;
  closeModal();
  if (!name) return;
  await deleteCategory(name);
  say('Categoria excluída.');
  render();
}

async function armDeviceDelete(id) {
  if (ui.deviceDeleteArmed === id) {
    ui.deviceDeleteArmed = null;
    await deleteDevice(id);
    say('Aparelho excluído.');
  } else {
    ui.deviceDeleteArmed = id;
  }
  render();
}

async function addProblem() {
  const area = ui.modal.category;
  const name = $('#pb_n').value.trim();
  const list = problemsOf(state.me.ws, area);
  if (!name) return say('Informe o problema.');
  if (list.some((x) => x.toLowerCase() === name.toLowerCase())) return say('Esse problema já existe.');
  await saveProblems(area, [...list, name]);
  openCategory(area);
}

async function removeProblem(index) {
  const area = ui.modal.category;
  await saveProblems(area, problemsOf(state.me.ws, area).filter((_, i) => i !== +index));
  openCategory(area);
}

async function addDeviceNote(id) {
  const text = $('#dv_t').value.trim();
  if (!text) return;
  await addDeviceLog(id, 'Anotação: ' + text);
  openDevice(id);
}

async function saveGroupName() {
  const name = $('#gr_n').value.trim();
  if (!name) return say('Informe o nome do grupo.');
  const id = ui.modal.group;
  closeModal();
  await renameGroup(id, name);
  render();
}

// ---------- Tutoriais ----------
async function submitTutorialStep() {
  const file = $('#tu_f').files[0];
  const txt = $('#tu_t').value.trim();
  if (!file && !txt) return say('Adicione uma foto ou uma descrição.');
  let img = '';
  try {
    if (file) img = await readPhoto(file);
  } catch (_) {
    return say('Não foi possível ler a imagem.');
  }
  const [cat, prob] = ui.modal.tutorial;
  try {
    await addTutorialStep(cat, prob, img, txt);
  } catch (_) {
    say('Não foi possível salvar (imagem muito grande?).');
  }
  reopenTutorial();
}

async function removeTutorialStep(id) {
  await deleteTutorialStep(id);
  reopenTutorial();
}

async function moveStep(value) {
  const [id, dir] = value.split('|');
  const [cat, prob] = ui.modal.tutorial;
  const done = moveTutorialStep(cat, prob, id, +dir);
  reopenTutorial();
  await done;
}

// ---------- Tarefas ----------
async function submitNewTask(btn) {
  const { form, error } = readNewTaskForm();
  if (error) {
    $('#f_m').textContent = error;
    return;
  }
  btn.disabled = true;
  await createTasks(form);
  ui.presetEmp = null;
  closeModal();
  say('Tarefa enviada para aceite.');
  render();
}

async function confirmComplete(btn) {
  const id = ui.modal.doneTaskId;
  const summary = $('#dn_t').value.trim();
  btn.disabled = true;
  closeModal();
  await taskAction(id, 'concluir', summary);
}

function moveAgendaDay(delta) {
  const week = currentWeek();
  const next = addDays(ui.agendaDay, delta);
  if (next >= week.s && next < week.e) ui.agendaDay = next;
  render();
}

// ---------- Conta e folgas ----------
async function saveProfile() {
  await patchMyProfile({ name: $('#p_n').value.trim() || state.me.name });
  say('Dados salvos.');
}

/** Valida a jornada: entrada < almoço início < almoço fim < saída. Retorna a mensagem de erro ou ''. */
function workHoursError({ start, end, bs, be }) {
  if (!start || !end || !bs || !be) return 'Preencha entrada, saída e o intervalo de almoço.';
  if (start >= end) return 'A saída precisa ser depois da entrada.';
  if (bs >= be) return 'O fim do almoço precisa ser depois do início.';
  if (bs <= start || be >= end) return 'O almoço precisa ficar dentro do horário de trabalho.';
  return '';
}

/** A tarefa agendada cai fora da jornada ou dentro do almoço? */
function outsideWorkHours(t, p) {
  const day = startOfDay(t.start);
  const lunch = breakOf(p, day);
  const end = taskEnd(t);
  return t.start < atTime(day, p.start) || end > atTime(day, p.end) || (t.start < lunch.e && end > lunch.s);
}

async function saveWorkHours() {
  const hours = { start: $('#p_s').value, end: $('#p_e').value, bs: $('#p_bs').value, be: $('#p_be').value };
  const error = workHoursError(hours);
  if (error) return say(error);
  await patchMyProfile(hours);
  say('Horário de trabalho salvo.');
  // Tarefas que ficaram fora da nova jornada voltam a pendente e são reencaixadas.
  const p = profileOf(state.uid);
  await requeueForTimeOff((t) => outsideWorkHours(t, p), 'horário de trabalho alterado');
}

async function saveWeeklyOff() {
  const wk = $$('.wk:checked').map((x) => +x.value);
  await patchMyProfile({ wk });
  say('Folga semanal salva.');
  await requeueForTimeOff((t) => wk.includes(new Date(t.start).getDay()), 'folga semanal');
}

async function addTimeOff() {
  const from = $('#o_s').value;
  const to = $('#o_e').value;
  if (!from || !to) return say('Informe as datas de início e fim.');
  const s = parseDateInput(from);
  const e = addDays(parseDateInput(to), 1); // "até" inclui o dia inteiro
  if (e <= s) return say('A data final precisa ser igual ou posterior à inicial.');
  const off = [...(profileOf(state.uid).off || []), { s, e, note: $('#o_n').value.trim() }];
  await patchMyProfile({ off });
  say('Folga adicionada.');
  await requeueForTimeOff((t) => off.some((x) => t.start < x.e && taskEnd(t) > x.s), 'indisponibilidade');
}

async function removeTimeOff(index) {
  const off = [...(profileOf(state.uid).off || [])];
  off.splice(+index, 1);
  await patchMyProfile({ off });
  await scheduleWaiting(state.uid);
}

async function chooseTheme(theme) {
  applyTheme(theme);
  updateMyProfile({ theme }).catch(() => {});
  render();
}

// ---------- Tabelas de despacho ----------
const ACTIONS_BY_ID = {
  // Login
  a_go: async (btn) => { btn.disabled = true; try { await submitAuth(); } finally { btn.disabled = false; } },
  a_mode: () => { ui.authMode = ui.authMode === 'in' ? 'up' : 'in'; ui.authMsg = ''; render(); },
  a_out: () => logout(),
  // Cabeçalho, menu e notificações
  bell: () => openNotifications(true),
  pnx: () => openNotifications(false),
  nclr: () => clearNotifications(),
  mnb: () => openMenu(true),
  av: () => openMenu(true),
  mnx: () => openMenu(false),
  // Tarefas
  nfab: () => { ui.presetEmp = null; openNewTask(); },
  f_go: submitNewTask,
  dn_ok: confirmComplete,
  dn_no: () => closeModal(),
  // Workstation
  w_save: saveCargo,
  w_done: finishSetup,
  dv_add: submitDevice,
  wc_add: submitCategory,
  cd_ok: confirmCategoryDelete,
  gr_ok: saveGroupName,
  pb_add: addProblem,
  tu_add: submitTutorialStep,
  // Conta e folgas
  p_go: saveProfile,
  wh_go: saveWorkHours,
  em_go: () => changeEmail(),
  pw_go: () => changePassword(),
  wk_go: saveWeeklyOff,
  o_go: addTimeOff,
};

const ACTIONS_BY_DATA = {
  // Navegação
  tab: (v) => goTo(v),
  go: (v) => { openMenu(false); ui.wsStep = 'dev'; goTo(v); },
  ag: (v) => { ui.agendaEmp = v; goTo('agenda'); },
  tf: (v) => { ui.taskFilter = v; render(); },
  day: (v) => moveAgendaDay(+v),
  wst: (v) => { ui.wsStep = v; render(); },
  th: chooseTheme,
  // Contas
  sw: () => { ui.accountSwitcher = !ui.accountSwitcher; render(); },
  acc: (v) => switchAccount(v),
  accx: (v) => { forgetAccount(v); render(); },
  newacc: () => { openMenu(false); logout(); },
  // Tarefas
  a: (v, btn) => (v === 'concluir' ? openCompleteTask(btn.dataset.i) : taskAction(btn.dataset.i, v)),
  d: (v, btn) => changeDuration(btn.dataset.i, +v),
  h: (v) => { ui.openHistory[v] = !ui.openHistory[v]; render(); },
  prop: () => { ui.proposal = buildProposal(ui.agendaEmp); render(); },
  ok: async () => { await applyProposal(); render(); },
  no: () => { ui.proposal = null; render(); },
  send: (v) => { ui.presetEmp = v; openNewTask(); },
  pk: (v) => toggleProblem(v),
  // Aparelhos e categorias
  dev: (v) => openDevice(v),
  rodev: (v) => openDeviceReadOnly(v),
  lg: addDeviceNote,
  ddel: armDeviceDelete,
  cat: (v) => openCategory(v),
  cdel: (v) => openCategoryDelete(v),
  grename: (v) => openGroupRename(v),
  gungroup: async (v) => { await ungroup(v); say('Grupo desfeito.'); render(); },
  pdel: removeProblem,
  // Tutoriais
  tut: (v) => openTutorial(...splitTutorialKey(v)),
  tdel: removeTutorialStep,
  tmv: moveStep,
  // Folgas
  rm: removeTimeOff,
};

/** "categoria||problema" → [categoria, problema]. */
const splitTutorialKey = (key) => {
  const [cat, ...rest] = key.split('||');
  return [cat, rest.join('||')];
};
