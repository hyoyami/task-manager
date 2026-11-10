/* ==========================================================================
   Listeners globais (delegação de eventos em `document`).
   Os elementos são recriados a cada render(), por isso nada se liga
   diretamente a eles.
   ========================================================================== */
'use strict';

async function onButtonClick(btn) {
  const byId = ACTIONS_BY_ID[btn.id];
  if (byId) return byId(btn);
  for (const [key, value] of Object.entries(btn.dataset)) {
    const handler = ACTIONS_BY_DATA[key];
    if (handler) return handler(value, btn);
  }
}

/** Cliques em elementos que não são botões (cartões e horários). */
function onElementClick(target) {
  const slot = target.closest('.slot');
  if (slot) return onSlotClick(slot);
  const info = target.closest('[data-open]');
  if (info) return openTaskInfo(info.dataset.open);
  const tut = target.closest('[data-tut]');
  if (tut) return openTutorial(...splitTutorialKey(tut.dataset.tut));
}

async function onClick(e) {
  const btn = e.target.closest('button');
  try {
    if (!btn) return await onElementClick(e.target);
    // Tira o foco do campo atual para que render() possa redesenhar a tela.
    const active = document.activeElement;
    if (active && active !== document.body) active.blur?.();
    await onButtonClick(btn);
  } catch (err) {
    console.error(err);
    say('Algo deu errado. Tente novamente.');
  }
}

async function onChange(e) {
  const x = e.target;
  try {
    if (x.id === 'af_c' || x.id === 'af_s') {
      ui.deviceFilter[x.id === 'af_c' ? 'cat' : 'status'] = x.value;
      x.blur();
      render();
    } else if (x.id === 'selEmp') {
      ui.agendaEmp = x.value;
      render();
    } else if (x.id === 'f_v') {
      $('#f_kbox').innerHTML = problemPicker(x.value);
    } else if (x.classList.contains('dsel') && +x.value) {
      x.blur();
      await setDuration(x.dataset.i, +x.value);
      render();
    } else if (x.classList.contains('dv_st')) {
      const d = state.myDevices[x.dataset.i];
      if (!d || x.value === d.status) return;
      await addDeviceLog(d.id, 'Status: ' + d.status + ' → ' + x.value, { status: x.value });
      openDevice(d.id);
      render();
    }
  } catch (err) {
    console.error(err);
    say('Algo deu errado. Tente novamente.');
  }
}

function onKeyDown(e) {
  if (e.key !== 'Enter') return;
  const id = e.target.id || '';
  if (id === 'pb_n' || id === 'gr_n') {
    e.preventDefault();
    $(id === 'pb_n' ? '#pb_add' : '#gr_ok').click();
  } else if (!state.me && !state.uid && id.startsWith('a_') && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    $('#a_go')?.click();
  }
}

function initEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeyDown);
  // Fundo do modal e da gaveta lateral fecham ao tocar.
  $('#md').addEventListener('click', (e) => { if (e.target.id === 'md') closeModal(); });
  $('#ov').addEventListener('click', () => { openNotifications(false); openMenu(false); });
  initDrag();
  initDeviceDrag();
}
