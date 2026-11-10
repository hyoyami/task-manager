/* ==========================================================================
   Notificações: painel lateral, contador do sino e pop-ups de novas.
   ========================================================================== */
'use strict';

const MAX_LISTED_NOTIFS = 40;
const MAX_POPUPS = 3;

/** Cor do marcador conforme o texto: r = cancelada/recusada, g = sucesso, y = atenção. */
function notifKind(txt) {
  if (/cancel|recus/i.test(txt)) return 'r';
  if (/conclu|agendada|iniciada/i.test(txt)) return 'g';
  if (/pendente|reagend|sem hor/i.test(txt)) return 'y';
  return '';
}

const unseenCount = () => state.notifs.filter((n) => n.at > (state.me?.seen || 0)).length;

function viewNotifications() {
  const all = state.notifs;
  if (!all.length) return emptyCard('Nenhuma notificação por enquanto.', true);
  const list = all.slice().sort((a, b) => b.at - a.at).slice(0, MAX_LISTED_NOTIFS);
  return '<div class="row between toolbar"><span class="muted">' + plural(all.length, 'notificação', 'notificações') + '</span>'
    + '<button class="small danger" id="nclr">Limpar todas</button></div>'
    + each(list, (n) => {
      const isNew = n.at > ui.notifSeenAt;
      return '<div class="notif' + when(isNew, ' new') + '"><span class="ndot ' + notifKind(n.txt) + '"></span>'
        + '<div class="notif-text">' + esc(n.txt) + '<div class="notif-time">' + timeAgo(n.at) + '</div></div>'
        + when(isNew, '<span class="notif-new">Nova</span>') + '</div>';
    });
}

/** Pop-up temporário no canto da tela (máx. 3 simultâneos). */
function showPopup(n) {
  const box = $('#pops');
  if (!box || box.children.length >= MAX_POPUPS) return;
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = '<span class="ndot ' + notifKind(n.txt) + '"></span><div class="pop-body">'
    + '<div class="pop-text">' + esc(n.txt) + '</div><div class="pop-time">agora</div></div>';
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 330);
  }, 1500);
}

async function clearNotifications() {
  const ids = state.notifs.map((n) => n._id).filter(Boolean);
  state.notifs = [];
  render();
  await Promise.all(ids.map((id) => doc('notifs/' + id).delete().catch(() => {})));
  say('Notificações limpas.');
}
