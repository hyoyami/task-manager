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

// ---------- Área de Trabalho ----------
async function saveCargo() {
  const cargo = $('#w_c').value;
  if (!cargo) return say('Selecione a função.');
  await updateWorkstation({ cargo, setup: true });
  ui.wsStep = 'dev';
  render();
}

async function submitDevice() {
  const name = $('#dv_n').value.trim();
  const ip = $('#dv_i').value.trim();
  if (!name) return say('Informe o nome do aparelho.');
  if (!isValidIp(ip)) return say('Informe um IP válido (ex.: 192.168.0.25).');
  await createDevice({ name, ip, area: $('#dv_a').value });
  clearFields('dv_n', 'dv_i');
  ui.wsStep = 'dev';
  say('Aparelho cadastrado.');
  render();
}

async function submitCategory() {
  const name = $('#wc_n').value.trim();
  const file = $('#wc_f').files[0];
  if (!name) return say('Informe o nome da categoria.');
  if (!file || file.type !== 'image/png') return say('Envie o ícone em PNG.');
  if (companyCategories().some((c) => c.name.toLowerCase() === name.toLowerCase())) return say('Essa categoria já existe.');
  await addCategory(name, await readIcon(file));
  clearFields('wc_n', 'wc_f');
  say('Categoria adicionada.');
  render();
}

async function confirmCategoryDelete() {
  const name = ui.modal.categoryToDelete;
  ui.modal.categoryToDelete = null;
  closeModal();
  if (!name) return;
  if (!canDeleteCategory(name)) return say('Esta categoria tem aparelhos: só o administrador pode excluí-la.');
  await deleteCategory(name);
  say('Categoria excluída.');
  render();
}

/** Excluir pela janela do aparelho (quem cadastrou ou o administrador). */
async function deleteDeviceFromModal(id) {
  const d = state.devices[id];
  if (!d || !canDeleteDevice(d)) return say('Só quem cadastrou o aparelho ou o administrador pode excluí-lo.');
  if (!confirm('Excluir o aparelho "' + d.name + '" e todo o seu log?')) return;
  closeModal();
  await deleteDevice(id);
  say('Aparelho excluído.');
  render();
}

/** Conclui a etapa "Aparelhos da empresa" (precisa de um aparelho ou de "cadastrar depois"). */
async function submitCompanySetup() {
  const later = $('#cs_skip')?.checked;
  if (!Object.keys(state.devices).length && !later) {
    return say('Cadastre ao menos um aparelho ou marque “Cadastrar os aparelhos depois”.');
  }
  await finishCompanySetup();
  ui.tab = Object.keys(state.devices).length ? 'workstation' : 'empresa';
  say('Tudo pronto! Agora convide a equipe na aba Empresa.');
  render();
}

async function armDeviceDelete(id) {
  const d = state.devices[id];
  if (!d || !canDeleteDevice(d)) return say('Só quem cadastrou o aparelho ou o administrador pode excluí-lo.');
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
  const list = problemsOf(area);
  if (!name) return say('Informe o problema.');
  if (list.some((x) => x.toLowerCase() === name.toLowerCase())) return say('Esse problema já existe.');
  await saveProblems(area, [...list, name]);
  openCategory(area);
}

async function removeProblem(index) {
  const area = ui.modal.category;
  await deleteProblem(area, index);
  openCategory(area);
}

async function submitProblemEdit() {
  const area = ui.modal.category;
  const index = ui.modal.problemIndex;
  const name = $('#pb_en').value.trim();
  if (!name) return say('Informe o nome do problema.');
  if (problemsOf(area).some((x, i) => i !== index && x.toLowerCase() === name.toLowerCase())) return say('Esse problema já existe.');
  const { rec, error } = readRecurrence('pb');
  if (error) return say(error);
  await saveProblem(area, index, name, rec);
  say('Problema salvo.');
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

// ---------- Empresa: entrar, criar, membros e convites ----------
async function submitCreateCompany() {
  const name = $('#ob_cn').value.trim();
  if (!name) return say('Informe o nome da empresa.');
  if (Object.values(state.companies).some((c) => String(c.name).toLowerCase() === name.toLowerCase())) {
    return say('Já existe uma empresa com esse nome.');
  }
  const { addr, error } = readAddress('ob');
  if (error) return say(error);
  await createCompany(name, addr);
  clearDraft();
  say('Empresa criada! Agora cadastre os aparelhos da empresa.');
}

async function submitJoinRequest() {
  const companyId = $('#ob_company').value;
  if (!companyId) return say('Selecione a empresa.');
  await requestJoin(companyId, $('#ob_role').value);
  clearDraft();
  say('Pedido enviado ao administrador.');
}

async function cancelJoinRequest() {
  await leaveCompany();
  say('Pedido cancelado.');
}

async function saveCompanyAddress(btn) {
  const { addr, error } = readAddress('adm', state.company.addr);
  if (error) return say(error);
  btn.disabled = true;
  try {
    const cityChanged = addr.ibge !== state.company.addr?.ibge;
    await updateCompany({ addr });
    say('Endereço salvo.' + (cityChanged ? ' Buscando os feriados de ' + addr.cidade + '…' : ''));
    if (cityChanged) await refreshHolidays();
  } finally {
    btn.disabled = false;
    render();
  }
}

async function refreshHolidays() {
  try {
    await ensureHolidays(true);
    say('Feriados de ' + state.company.addr.cidade + '/' + state.company.addr.uf + ' atualizados.');
    await requeueHolidayTasks();
  } catch (_) {
    say('Não foi possível buscar os feriados agora. Tente de novo mais tarde.');
  }
  render();
}

/** Ao digitar o CEP (8 dígitos), preenche rua, bairro, cidade e UF pelo ViaCEP. */
async function onCepInput(input) {
  const p = input.id.replace(/_cep$/, '');
  input.value = formatCep(input.value);
  const msg = $('#' + p + '_cepm');
  if (onlyDigits(input.value).length !== 8) {
    ui.cepLookup[p] = null;
    return;
  }
  if (msg) msg.textContent = 'Buscando o CEP…';
  let found = null;
  try {
    found = await lookupCep(input.value);
  } catch (_) {
    if (msg) msg.textContent = 'Não foi possível consultar o CEP agora. Verifique a internet.';
    return;
  }
  if (formatCep(input.value) !== found?.cep && found) return; // digitou outro CEP enquanto buscava
  ui.cepLookup[p] = found;
  if (!found) {
    if (msg) msg.textContent = 'CEP não encontrado. Confira o número.';
    ['rua', 'bai', 'cid', 'uf'].forEach((k) => { const el = $('#' + p + '_' + k); if (el) el.value = ''; });
    return;
  }
  const set = (k, v) => { const el = $('#' + p + '_' + k); if (el) el.value = v; };
  set('rua', found.rua);
  set('bai', found.bairro);
  set('cid', found.cidade);
  set('uf', found.uf);
  if (msg) msg.textContent = found.cidade + '/' + found.uf + ' — agora informe o número.';
  $('#' + p + '_num')?.focus();
}

async function saveCompanyName() {
  const name = $('#adm_name').value.trim();
  if (!name) return say('Informe o nome da empresa.');
  await renameCompany(name);
  say('Nome da empresa salvo.');
}

async function acceptJoinRequest(id) {
  const role = $('.jr-role[data-id="' + id + '"]')?.value || 'sol';
  const cargo = $('.jr-cargo[data-id="' + id + '"]')?.value || '';
  await acceptMember(id, role, cargo);
  say('Membro aceito como ' + ROLE_LABEL[role] + '.');
}

async function rejectJoinRequest(id) {
  if (!confirm('Recusar o pedido de entrada?')) return;
  await rejectMember(id);
  say('Pedido recusado.');
}

async function removeCompanyMember(id) {
  if (!confirm('Remover ' + nameOf(id) + ' da empresa?')) return;
  await removeMember(id);
  say('Membro removido.');
}

async function generateInvite() {
  const role = $('#adm_ir').value;
  const code = await createInvite(role);
  copyText(inviteLink(code), 'Link de convite (' + ROLE_LABEL[role] + ') criado e copiado.');
}

/** Copia para a área de transferência (com aviso; se o navegador bloquear, só avisa). */
async function copyText(text, okMsg = 'Copiado.') {
  try {
    await navigator.clipboard.writeText(text);
    say(okMsg);
  } catch (_) {
    say('Selecione o link e copie manualmente.');
  }
}

async function removeInvite(code) {
  if (!confirm('Excluir este link? Quem ainda não usou não conseguirá mais entrar por ele.')) return;
  await deleteInvite(code);
  say('Link excluído.');
}

async function submitCargo() {
  const name = $('#adm_cg_n').value.trim();
  if (!name) return say('Informe o nome da função.');
  try {
    await addCargo(name);
  } catch (err) {
    return say(err.message);
  }
  clearFields('adm_cg_n');
  say('Função criada. Marque as categorias que ela vê.');
  render();
}

async function removeCargo(key) {
  const users = Object.values(state.profiles).filter((p) => p.ws?.cargo === key).length;
  if (!confirm('Excluir a função?' + (users ? ' ' + users + ' membro(s) precisarão escolher outra.' : ''))) return;
  await deleteCargo(key);
  render();
}

// ---------- Exclusões ----------
async function confirmDeleteAccount(btn) {
  if ($('#xa_t').value.trim().toUpperCase() !== 'EXCLUIR') return say('Digite EXCLUIR para confirmar.');
  btn.disabled = true;
  try {
    await state.auth.verifyPassword($('#xa_p').value);
    await state.db.call('delete_my_account');
  } catch (err) {
    btn.disabled = false;
    return say(err.message);
  }
  const id = state.uid;
  closeModal();
  forgetAccount(id);
  await state.auth.signOut().catch(() => {});
  showLogin();
  say('Sua conta foi excluída.');
}

async function confirmDeleteCompany(btn) {
  if ($('#xc_t').value.trim() !== (state.company?.name || '')) return say('O nome digitado não confere.');
  btn.disabled = true;
  try {
    await state.auth.verifyPassword($('#xc_p').value);
    await state.db.call('delete_company');
  } catch (err) {
    btn.disabled = false;
    return say(err.message);
  }
  closeModal();
  say('Empresa excluída.');
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
  shiftAgenda(delta);
  render();
}

/** Abre a agenda de um dia (visão Dia). */
function openAgendaDay(ms) {
  ui.agendaDay = startOfDay(ms);
  ui.agendaView = 'dia';
  render();
}

// ---------- Conta e folgas ----------
async function saveProfile() {
  const patch = { name: $('#p_n').value.trim() || state.me.name };
  const username = normalizeUsername($('#p_u')?.value);
  if (username !== normalizeUsername(state.me.username)) {
    if (!isValidUsername(username)) return say(USERNAME_RULE);
    if (!(await usernameAvailable(username, state.uid))) return say('Este nome de usuário já está em uso.');
    patch.username = username;
  }
  try {
    await patchMyProfile(patch);
  } catch (err) {
    return say(/duplicate|unique|username/i.test(err.message) ? 'Este nome de usuário já está em uso.' : 'Não foi possível salvar.');
  }
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
  clearFields('o_s', 'o_e', 'o_n');
  say('Folga adicionada.');
  await requeueForTimeOff((t) => off.some((x) => t.start < x.e && taskEnd(t) > x.s), 'indisponibilidade');
}

async function confirmAbsentToday(btn) {
  btn.disabled = true;
  closeModal();
  const { moved, pending, already } = await markAbsentToday();
  if (already) say('Você já está marcado como ausente hoje.');
  else if (!moved && !pending) say('Hoje marcado como ausente.');
  else say('Hoje marcado como ausente. ' + plural(moved, 'tarefa reagendada', 'tarefas reagendadas') + ' para o dia seguinte'
    + (pending ? '; ' + plural(pending, 'ficou pendente', 'ficaram pendentes') + ' (sem horário livre nesta semana)' : '') + '.');
  render();
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
  a_go: async (btn) => {
    btn.disabled = true;
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
    try { await submitAuth(); } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.removeAttribute('aria-busy');
    }
  },
  a_resend: resendConfirmation,
  a_back: () => { ui.authMode = 'in'; ui.authMsg = ''; render(); setTimeout(() => { const e = $('#a_e'); if (e) e.value = ui.pendingEmail; }, 0); },
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
  // Área de Trabalho
  w_save: saveCargo,
  dv_add: submitDevice,
  wc_add: submitCategory,
  cd_ok: confirmCategoryDelete,
  gr_ok: saveGroupName,
  pb_add: addProblem,
  pb_save: submitProblemEdit,
  tu_add: submitTutorialStep,
  // Exclusões
  xa_open: () => openDeleteAccount(),
  xa_ok: confirmDeleteAccount,
  xc_open: () => openDeleteCompany(),
  xc_ok: confirmDeleteCompany,
  // Empresa
  cs_done: submitCompanySetup,
  ob_create: submitCreateCompany,
  ob_join: submitJoinRequest,
  ob_cancel: cancelJoinRequest,
  adm_save: saveCompanyName,
  adm_addr: saveCompanyAddress,
  adm_hol: refreshHolidays,
  adm_inv: generateInvite,
  adm_cg_add: submitCargo,
  // Conta e folgas
  p_go: saveProfile,
  wh_go: saveWorkHours,
  em_go: () => changeEmail(),
  pw_go: () => changePassword(),
  wk_go: saveWeeklyOff,
  o_go: addTimeOff,
  ab_open: openAbsentConfirm,
  so_ok: async (btn) => { btn.disabled = true; const id = ui.modal.startTaskId; closeModal(); await taskAction(id, 'iniciar'); render(); },
  ab_ok: confirmAbsentToday,
};

const ACTIONS_BY_DATA = {
  // Navegação
  tab: (v) => goTo(v),
  go: (v) => { openMenu(false); ui.wsStep = 'dev'; goTo(v); },
  ag: (v) => { ui.agendaEmp = v; goTo('agenda'); },
  tf: (v) => { ui.taskFilter = v; render(); },
  day: (v) => moveAgendaDay(+v),
  av: (v) => { ui.agendaView = v; render(); },
  agday: (v) => openAgendaDay(+v),
  agtoday: () => openAgendaDay(Date.now()),
  seeall: () => { ui.showAllWaiting = !ui.showAllWaiting; render(); },
  wst: (v) => { ui.wsStep = v; render(); },
  th: chooseTheme,
  // Contas
  sw: () => { ui.accountSwitcher = !ui.accountSwitcher; render(); },
  acc: (v) => switchAccount(v),
  accx: (v) => { forgetAccount(v); render(); },
  newacc: () => { openMenu(false); return addAnotherAccount(); },
  // Tarefas
  a: (v, btn) => {
    if (v === 'concluir') return openCompleteTask(btn.dataset.i);
    // Iniciar fora do expediente só com confirmação (senão a tarefa entraria hoje, depois do horário).
    const t = state.tasks[btn.dataset.i];
    if (v === 'iniciar' && t && isOutsideWorkHours(profileOf(t.emp), Date.now())) return openStartOutsideHours(t.id);
    return taskAction(btn.dataset.i, v);
  },
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
  fulllog: (v) => openDeviceLog(v),
  lg: addDeviceNote,
  ddel: armDeviceDelete,
  devdel: deleteDeviceFromModal,
  csdel: async (v) => { await deleteDevice(v); say('Aparelho removido.'); render(); },
  cat: (v) => openCategory(v),
  cdel: (v) => openCategoryDelete(v),
  grename: (v) => openGroupRename(v),
  gungroup: async (v) => { await ungroup(v); say('Grupo desfeito.'); render(); },
  pdel: removeProblem,
  pedit: (v) => openProblemEdit(ui.modal.category, +v),
  // Tutoriais
  tut: (v) => openTutorial(...splitTutorialKey(v)),
  tdel: removeTutorialStep,
  tmv: moveStep,
  claim: async (v) => { await claimTask(v, ui.poolDur[v] || 0); render(); },
  // Empresa (administrador)
  accept: acceptJoinRequest,
  reject: rejectJoinRequest,
  mremove: removeCompanyMember,
  invcopy: (v) => copyText(inviteLink(v), 'Link copiado.'),
  invdel: removeInvite,
  cgdel: removeCargo,
  // Folgas
  rm: removeTimeOff,
};

/** "categoria||problema" → [categoria, problema]. */
const splitTutorialKey = (key) => {
  const [cat, ...rest] = key.split('||');
  return [cat, rest.join('||')];
};
