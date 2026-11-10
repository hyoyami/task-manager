/* ==========================================================================
   Organização dos aparelhos na Workstation por arrasto.

   - Mouse: arrasta pelo cartão (ou pelo cabeçalho do grupo).
   - Toque: arrasta pela alça ⠿ (o resto do cartão continua rolando a tela).
   Ao soltar um aparelho:
     na borda de outro aparelho → antes/depois dele;
     no meio de outro aparelho  → cria grupo (ou entra no grupo dele);
     sobre um grupo             → entra no fim do grupo;
     fora dos grupos            → fica solto, no fim.
   Grupos só são reordenados (antes/depois de outro item).
   Na aba Aparelhos do solicitante (#cat_board) só as categorias se movem.
   ========================================================================== */
'use strict';

/** Workstation (aparelhos e grupos) e aba Aparelhos do solicitante (só categorias). */
const DEVICE_BOARDS = '#dv_board,#cat_board';
const DROP_EDGE = 0.28; // fração do cartão que conta como "borda"
const DROP_CLASSES = ['drop-into', 'drop-before-h', 'drop-after-h', 'drop-before-v', 'drop-after-v', 'drop-root'];

function clearDropMarks() {
  DROP_CLASSES.forEach((c) => $$('.' + c).forEach((el) => el.classList.remove(c)));
}

/** Posição relativa do ponteiro no elemento (0–1), no eixo em que os itens se enfileiram. */
function relativePos(el, board, x, y, forceVertical = false) {
  const r = el.getBoundingClientRect();
  const vertical = forceVertical || r.width > board.clientWidth * 0.6; // uma coluna (celular)
  return { t: vertical ? (y - r.top) / r.height : (x - r.left) / r.width, vertical };
}

/** Calcula o destino do arrasto sob o ponteiro, ou null. */
function deviceDropTarget(x, y, drag) {
  const el = document.elementFromPoint(x, y);
  const board = el?.closest(DEVICE_BOARDS);
  if (!board) return null;
  const card = el.closest('.device-card[data-did]');
  const group = el.closest('.dev-group[data-gid]');

  if (drag.type === 'dev') {
    if (card) {
      if (card.dataset.did === drag.id) return null;
      const { t, vertical } = relativePos(card, board, x, y);
      const kind = t < DROP_EDGE ? 'before' : t > 1 - DROP_EDGE ? 'after' : 'combine';
      return { kind, ref: card.dataset.did, el: card, vertical };
    }
    if (group) return { kind: 'group', groupId: group.dataset.gid, el: group };
    return { kind: 'root', el: board };
  }

  // Arrastando um grupo: posiciona antes/depois do item do nível de cima sob o ponteiro.
  const top = group || card;
  if (!top) return { kind: 'end', el: board };
  if (group && group.dataset.gid === drag.id) return null;
  const { t, vertical } = relativePos(top, board, x, y, !!group);
  return { kind: t < 0.5 ? 'before' : 'after', key: group ? 'g:' + group.dataset.gid : 'd:' + card.dataset.did, el: top, vertical };
}

function markDropTarget(target) {
  clearDropMarks();
  if (!target) return;
  const axis = target.vertical ? 'v' : 'h';
  const cls = { combine: 'drop-into', group: 'drop-into', root: 'drop-root', end: 'drop-root' }[target.kind]
    || 'drop-' + target.kind + '-' + axis;
  target.el.classList.add(cls);
}

function moveDeviceDrag(x, y) {
  const d = ui.deviceDrag;
  d.x = x;
  d.y = y;
  if (!d.moved) {
    if (Math.hypot(x - d.x0, y - d.y0) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    d.el.classList.add('drag-source');
    d.ghost.style.display = '';
  }
  d.ghost.style.left = x - 30 + 'px';
  d.ghost.style.top = y - 20 + 'px';
  d.target = deviceDropTarget(x, y, d);
  markDropTarget(d.target);
}

function endDeviceDrag() {
  const d = ui.deviceDrag;
  ui.deviceDrag = null;
  if (!d) return null;
  clearInterval(d.timer);
  d.ghost.remove();
  d.el.classList.remove('drag-source');
  clearDropMarks();
  return d;
}

function onDevicePointerDown(e) {
  const board = e.target.closest(DEVICE_BOARDS);
  if (ui.drag || ui.deviceDrag || !board) return;
  const categoriesOnly = board.id === 'cat_board';
  if (e.target.closest('button,select,input,textarea,a')) return;
  const mouse = e.pointerType === 'mouse';
  if (mouse && e.button !== 0) return;

  const handle = e.target.closest('.dv-handle,.group-handle');
  const card = e.target.closest('.device-card[data-did]');
  const head = e.target.closest('.dev-group-head');
  let source = null;
  if (head && (mouse || handle)) {
    const group = head.closest('.dev-group');
    source = { type: 'group', id: group.dataset.gid, el: group, ghostFrom: head };
  } else if (card && (mouse || handle) && !categoriesOnly) {
    source = { type: 'dev', id: card.dataset.did, el: card, ghostFrom: card };
  }
  if (!source) return;

  e.preventDefault();
  const ghost = source.ghostFrom.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = Math.min(source.ghostFrom.offsetWidth, 260) + 'px';
  ghost.style.display = 'none';
  document.body.appendChild(ghost);

  ui.deviceDrag = { ...source, categoriesOnly, ghost, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, target: null };
  ui.deviceDrag.timer = setInterval(() => {
    const d = ui.deviceDrag;
    if (!d || !d.moved) return;
    if (d.y < AUTOSCROLL_EDGE_PX) scrollBy(0, -AUTOSCROLL_STEP_PX);
    else if (d.y > innerHeight - AUTOSCROLL_EDGE_PX) scrollBy(0, AUTOSCROLL_STEP_PX);
    moveDeviceDrag(d.x, d.y);
  }, 30);
}

async function onDevicePointerUp() {
  const d = endDeviceDrag();
  if (!d) return;
  if (d.moved && d.target) {
    if (d.type === 'dev') {
      const created = await moveDevice(d.id, d.target);
      if (created) {
        render();
        openGroupRename(created.id, true);
        return;
      }
    } else if (d.categoriesOnly) {
      await moveCategory(d.id, d.target);
    } else {
      await moveGroup(d.id, d.target);
    }
  }
  render();
}

function initDeviceDrag() {
  document.addEventListener('pointerdown', onDevicePointerDown);
  document.addEventListener('pointermove', (e) => { if (ui.deviceDrag) moveDeviceDrag(e.clientX, e.clientY); });
  document.addEventListener('pointerup', onDevicePointerUp);
  document.addEventListener('pointercancel', () => { if (endDeviceDrag()) render(); });
}
