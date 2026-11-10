/* ==========================================================================
   Moldura da aplicação: cabeçalho, navegação inferior, menu lateral,
   painel de notificações e toast.
   ========================================================================== */
'use strict';

const ICON_BELL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const ICON_MENU = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

function headerHtml() {
  const unseen = unseenCount();
  const me = state.me;
  return '<b class="brand">TASK MANAGER</b><span class="row nowrap gap-sm">'
    + '<button id="bell" class="icon-btn" aria-label="Notificações">' + ICON_BELL + when(unseen, '<span class="badge">' + unseen + '</span>') + '</button>'
    + '<button id="av" class="' + when(ui.tab === 'perfil', 'on') + '" aria-label="Perfil" title="Perfil" style="background:' + colorFor(me.id) + '">' + esc(initial(me.name)) + '</button>'
    + '<button id="mnb" class="icon-btn" aria-label="Menu">' + ICON_MENU + '</button></span>';
}

function navHtml() {
  return each(tabsFor(state.me.role), ([key, label]) =>
    '<button data-tab="' + key + '" class="' + when(ui.tab === key, 'on') + '">' + label + '</button>');
}

function menuHtml() {
  const me = state.me;
  const item = (go, label) => '<button class="menu-item" data-go="' + go + '">' + label + '</button>';
  let h = '<div class="row nowrap menu-profile">' + avatar(me.id, me.name, 42)
    + '<div><b>' + esc(me.name) + '</b><div class="muted">' + (isEmployee() ? 'Funcionário' : 'Solicitante') + '</div></div></div>'
    + '<div class="menu-list">' + item('tutoriais', 'Tutoriais') + item('perfil', 'Configurações da conta')
    + when(isEmployee(), item('wcfg', 'Workstation configuração') + item('folgas', 'Horário de trabalho e folgas'))
    + '<button class="menu-item" data-sw="1">Trocar de conta</button>';
  if (ui.accountSwitcher) {
    const others = savedAccounts().filter((a) => a.id !== state.uid);
    h += '<div class="card flush">'
      + (each(others, (a) => '<div class="row between nowrap mb-6">'
        + '<button class="small account-btn" data-acc="' + esc(a.id) + '">' + avatar(a.id, a.name, 26) + esc(a.name) + '</button>'
        + '<button class="small danger" data-accx="' + esc(a.id) + '" title="Remover da lista">✕</button></div>')
        || '<span class="muted">Nenhuma outra conta salva neste aparelho.</span>')
      + '<p class="mb-0"><button class="small" data-newacc="1">＋ Entrar com outra conta</button></p></div>';
  }
  return h + '<button class="menu-item danger" id="a_out">Sair</button></div>';
}

function openMenu(open) {
  $('#mn').classList.toggle('open', open);
  $('#ov').classList.toggle('open', open);
  if (!open) ui.accountSwitcher = false;
}

function openNotifications(open) {
  $('#pn').classList.toggle('open', open);
  $('#ov').classList.toggle('open', open);
  if (!open) return;
  ui.notifSeenAt = state.me?.seen || 0;
  $('#pnb').innerHTML = viewNotifications();
  if (state.uid) updateMyProfile({ seen: Date.now() }).catch(() => {});
}

let toastTimer = null;
/** Mensagem curta na parte de baixo da tela. */
function say(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
