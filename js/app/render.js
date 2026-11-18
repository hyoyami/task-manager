/* ==========================================================================
   Roteamento por abas e renderização.

   render() redesenha a tela inteira a partir de `state`/`ui`. Não redesenha:
   - durante um arrasto (ui.drag / ui.deviceDrag), para não perder o cartão;
   - com um campo de texto em foco dentro de <main> (exceto na Agenda),
     para não apagar o que o usuário está digitando.
   ========================================================================== */
'use strict';

/** Abas da barra de navegação por papel. */
const NAV_TABS = {
  func: [['agenda', 'Agenda'], ['tarefas', 'Tarefas'], ['workstation', 'Área de Trabalho']],
  sol: [['agenda', 'Agenda'], ['tarefas', 'Tarefas'], ['equipe', 'Equipe'], ['aparelhos', 'Aparelhos']],
  admin: [['agenda', 'Agenda'], ['tarefas', 'Tarefas'], ['equipe', 'Equipe'], ['workstation', 'Área de Trabalho'], ['empresa', 'Empresa']],
};
const tabsFor = (role) => NAV_TABS[role] || NAV_TABS.sol;

/** Telas: aba → [função de renderização, papéis permitidos (vazio = todos)]. */
const VIEWS = {
  agenda: [viewAgenda, []],
  tarefas: [viewTasks, []],
  equipe: [viewTeam, ['sol', 'admin']],
  aparelhos: [viewDevices, ['sol']],
  workstation: [viewWorkstation, ['func', 'admin']],
  wcfg: [viewWorkstationConfig, ['func']],
  folgas: [viewTimeOff, ['func', 'admin']],
  empresa: [viewCompany, ['admin']],
  perfil: [viewAccount, []],
  tutoriais: [viewTutorials, []],
};

function canSee(tab, role) {
  const view = VIEWS[tab];
  return !!view && (!view[1].length || view[1].includes(role));
}

function goTo(tab) {
  ui.tab = tab;
  render();
}

function isTypingInMain() {
  const el = document.activeElement;
  return el && /INPUT|TEXTAREA|SELECT/.test(el.tagName) && el.closest('main');
}

function render() {
  if (ui.drag || ui.deviceDrag) return;
  if (state.me && ui.tab !== 'agenda' && isTypingInMain()) return;

  if (!state.me) return renderLoggedOut();
  document.body.classList.remove('auth-screen');
  document.body.classList.toggle('auth-bg', !isActiveMember() || needsCompanySetup());

  $('#top').innerHTML = headerHtml();
  $('#pnb').innerHTML = viewNotifications();
  $('#mn_b').innerHTML = menuHtml();

  // Sem empresa (ou aguardando aprovação): só a tela de entrada.
  if (!isActiveMember()) {
    if (ui.tab !== 'perfil') ui.tab = 'onboarding';
    $('#nav').innerHTML = '';
    $('#nfab').classList.remove('show');
    $('#app').classList.remove('wide');
    renderApp(ui.tab === 'perfil' ? viewAccount() : viewOnboarding());
    return;
  }

  // Empresa recém-criada: etapa "Aparelhos da empresa" antes de liberar as abas.
  if (needsCompanySetup()) {
    if (ui.tab !== 'perfil') ui.tab = 'setup';
    $('#nav').innerHTML = '';
    $('#nfab').classList.remove('show');
    $('#app').classList.remove('wide');
    renderApp(ui.tab === 'perfil' ? viewAccount() : viewCompanySetup());
    return;
  }

  if (!canSee(ui.tab, state.me.role)) ui.tab = 'agenda';
  $('#nav').innerHTML = navHtml();
  $('#nfab').classList.toggle('show', canRequest());
  $('#app').classList.toggle('wide', ui.tab === 'agenda');
  renderApp(VIEWS[ui.tab][0]());
}

function renderLoggedOut() {
  document.body.classList.toggle('auth-screen', !state.uid);
  document.body.classList.remove('auth-bg');
  $('#nav').innerHTML = '';
  $('#top').innerHTML = '';
  $('#nfab').classList.remove('show');
  openNotifications(false);
  openMenu(false);
  // Com sessão salva, o perfil ainda está chegando do banco.
  if (state.uid) {
    $('#app').innerHTML = '<p class="muted">Carregando…</p>';
    lastRenderedTab = null;
    return;
  }
  // Mesma tela (entrar/criar conta): mantém o que já foi digitado, até a senha.
  // Depois de recarregar a página, volta para a tela em que a pessoa estava (ex.: "Criar conta").
  if (!draftModeRestored) {
    draftModeRestored = true;
    if (readDraft()._mode === 'up' && ui.authMode === 'in') ui.authMode = 'up';
  }
  const app = $('#app');
  const key = 'login:' + ui.authMode;
  const saved = lastRenderedTab === key ? captureFields(app) : null;
  app.innerHTML = viewLogin();
  lastRenderedTab = key;
  if (saved && saved.size) restoreFields(app, saved);
  restoreDraft(app);
}

// ---------- Rascunho das telas de entrada (sobrevive a recarregar a página) ----------
// No celular, "puxar para atualizar" ou o navegador descartar a aba (ao abrir o e-mail, por exemplo)
// recarregam a página. O que foi digitado no cadastro e na criação da empresa fica guardado na sessão
// da aba (sessionStorage) até dar certo. A senha nunca é guardada.
const DRAFT_KEY = 'tm_draft';
const DRAFT_FIELDS = /^(a_(n|u|e|k)|ob_(cn|cep|num|rua|bai|comp|company|role))$/;
let draftModeRestored = false;

function readDraft() {
  try { return JSON.parse(storage.get(DRAFT_KEY, sessionStorage) || '{}'); } catch (_) { return {}; }
}

function saveDraft(el) {
  if (!el?.id || !DRAFT_FIELDS.test(el.id)) return;
  const draft = readDraft();
  draft[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  if (el.id.startsWith('a_')) draft._mode = ui.authMode;
  storage.set(DRAFT_KEY, JSON.stringify(draft), sessionStorage);
}

const clearDraft = () => storage.remove(DRAFT_KEY, sessionStorage);

/** Preenche os campos vazios com o rascunho (e refaz a busca do CEP, que preenche cidade/UF). */
function restoreDraft(root) {
  const draft = readDraft();
  Object.entries(draft).forEach(([id, value]) => {
    if (id.startsWith('_')) return;
    const el = root.querySelector('#' + id);
    if (!el) return;
    if (el.type === 'checkbox') { if (!isDirty(el)) el.checked = !!value; return; }
    if (el.value || value === '' || value == null) return;
    el.value = value;
    if (el.classList.contains('cep-input') && !ui.cepLookup[id.replace(/_cep$/, '')]) onCepInput(el);
  });
}

// ---------- Preservar o que a pessoa está preenchendo ----------
// Atualizações em tempo real redesenham a tela a qualquer momento. Na mesma tela, o que a pessoa já
// escolheu ou digitou (e ainda não salvou) é guardado antes e restaurado depois.
let lastRenderedTab = null;

const fieldKey = (el) => el.id
  || (el.className && (el.dataset.id || el.dataset.i) ? el.className + '|' + (el.dataset.id || el.dataset.i) : '');

function isDirty(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
  if (el.tagName === 'SELECT') return [...el.options].some((o) => o.selected !== o.defaultSelected);
  return el.value !== el.defaultValue;
}

function captureFields(root) {
  const saved = new Map();
  root.querySelectorAll('input, select, textarea').forEach((el) => {
    const key = fieldKey(el);
    // data-live: o valor vem do estado da tela (ex.: data da agenda), não é rascunho do usuário.
    if (!key || el.type === 'file' || 'live' in el.dataset || !isDirty(el)) return;
    saved.set(key, el.type === 'checkbox' || el.type === 'radio' ? { checked: el.checked } : { value: el.value });
  });
  return saved;
}

function restoreFields(root, saved) {
  root.querySelectorAll('input, select, textarea').forEach((el) => {
    const v = saved.get(fieldKey(el));
    if (!v) return;
    if ('checked' in v) el.checked = v.checked;
    else el.value = v.value;
  });
}

/** Rolagem horizontal das faixas (ex.: "Tarefas para agendar"), para o redesenho não voltar ao início. */
const captureScroll = (root) => [...root.querySelectorAll('.strip')].map((el) => el.scrollLeft);
const restoreScroll = (root, list) => root.querySelectorAll('.strip').forEach((el, i) => { if (list[i]) el.scrollLeft = list[i]; });

function renderApp(html) {
  const app = $('#app');
  const sameTab = lastRenderedTab === ui.tab;
  const saved = sameTab ? captureFields(app) : null;
  const scroll = sameTab ? captureScroll(app) : [];
  app.innerHTML = html;
  lastRenderedTab = ui.tab;
  if (saved && saved.size) restoreFields(app, saved);
  restoreScroll(app, scroll);
  restoreDraft(app);
}
