/* ==========================================================================
   Agendamento por arrasto (mouse/toque) ou por toque em dois passos:
   1. arrastar o cartão (⠿) até um horário livre; ou
   2. tocar no cartão (seleciona) e depois tocar no horário livre.
   ========================================================================== */
'use strict';

const DRAG_THRESHOLD_PX = 6;
const AUTOSCROLL_EDGE_PX = 90;
const AUTOSCROLL_STEP_PX = 14;

function highlightSlot(el) {
  $$('.slot.hot').forEach((x) => x.classList.remove('hot'));
  if (el) el.classList.add('hot');
}

function moveDrag(x, y) {
  const d = ui.drag;
  d.x = x;
  d.y = y;
  if (!d.moved) {
    if (Math.hypot(x - d.x0, y - d.y0) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    d.el.style.opacity = 0.4;
    d.ghost.style.display = '';
  }
  d.ghost.style.left = x - 30 + 'px';
  d.ghost.style.top = y - 20 + 'px';
  d.target = document.elementFromPoint(x, y)?.closest('.slot') || null;
  highlightSlot(d.target);
}

function endDrag() {
  const d = ui.drag;
  ui.drag = null;
  if (!d) return null;
  clearInterval(d.timer);
  d.ghost.remove();
  d.el.style.opacity = '';
  highlightSlot(null);
  return d;
}

function onPointerDown(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle || ui.drag || e.target.closest('select,button')) return;
  const card = handle.closest('[data-tid]');
  if (!card) return;
  if (!state.tasks[card.dataset.tid]?.dur) return say('Defina a duração antes de arrastar.');

  e.preventDefault();
  const ghost = card.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.style.width = card.offsetWidth + 'px';
  ghost.style.display = 'none';
  document.body.appendChild(ghost);

  ui.drag = { id: card.dataset.tid, ghost, el: card, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, target: null };
  // Rolagem automática perto das bordas da tela.
  ui.drag.timer = setInterval(() => {
    const d = ui.drag;
    if (!d || !d.moved) return;
    if (d.y < AUTOSCROLL_EDGE_PX) scrollBy(0, -AUTOSCROLL_STEP_PX);
    else if (d.y > innerHeight - AUTOSCROLL_EDGE_PX) scrollBy(0, AUTOSCROLL_STEP_PX);
    moveDrag(d.x, d.y);
  }, 30);
}

async function onPointerUp() {
  const d = endDrag();
  if (!d) return;
  if (d.moved && d.target) {
    await scheduleAt(d.id, +d.target.dataset.t);
  } else if (!d.moved) {
    ui.selectedTask = ui.selectedTask === d.id ? null : d.id;
    if (ui.selectedTask) say('Toque em um horário livre da agenda.');
  }
  render();
}

/** Toque num horário livre com um cartão selecionado. */
async function onSlotClick(slot) {
  if (!ui.selectedTask) return;
  const id = ui.selectedTask;
  ui.selectedTask = null;
  await scheduleAt(id, +slot.dataset.t);
  render();
}

function initDrag() {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', (e) => { if (ui.drag) moveDrag(e.clientX, e.clientY); });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', () => { endDrag(); render(); });
}
