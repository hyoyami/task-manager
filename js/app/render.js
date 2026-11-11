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
  func: [['agenda', 'Agenda'], ['tarefas', 'Tarefas'], ['workstation', 'Workstation']],
  sol: [['agenda', 'Agenda'], ['tarefas', 'Tarefas'], ['equipe', 'Equipe'], ['aparelhos', 'Aparelhos']],
};
const tabsFor = (role) => NAV_TABS[role] || NAV_TABS.sol;

/** Telas: aba → [função de renderização, papéis permitidos (vazio = todos)]. */
const VIEWS = {
  agenda: [viewAgenda, []],
  tarefas: [viewTasks, []],
  equipe: [viewTeam, ['sol']],
  aparelhos: [viewDevices, ['sol']],
  workstation: [viewWorkstation, ['func']],
  wcfg: [viewWorkstationConfig, ['func']],
  folgas: [viewTimeOff, ['func']],
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

  if (!canSee(ui.tab, state.me.role)) ui.tab = 'agenda';
  $('#nav').innerHTML = navHtml();
  $('#top').innerHTML = headerHtml();
  $('#pnb').innerHTML = viewNotifications();
  $('#mn_b').innerHTML = menuHtml();
  $('#nfab').classList.toggle('show', !isEmployee());
  $('#app').classList.toggle('wide', ui.tab === 'agenda');
  $('#app').innerHTML = VIEWS[ui.tab][0]();
}

function renderLoggedOut() {
  $('#nav').innerHTML = '';
  $('#top').innerHTML = '';
  $('#nfab').classList.remove('show');
  openNotifications(false);
  openMenu(false);
  // Com sessão salva, o perfil ainda está chegando do banco.
  $('#app').innerHTML = state.uid ? '<p class="muted">Carregando…</p>' : viewLogin();
}
