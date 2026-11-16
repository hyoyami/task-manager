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
  $('#app').innerHTML = state.uid ? '<p class="muted">Carregando…</p>' : viewLogin();
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

function renderApp(html) {
  const app = $('#app');
  const sameTab = lastRenderedTab === ui.tab;
  const saved = sameTab ? captureFields(app) : null;
  app.innerHTML = html;
  lastRenderedTab = ui.tab;
  if (saved && saved.size) restoreFields(app, saved);
}
