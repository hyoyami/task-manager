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
  const pinned = target.closest('[data-goto]');
  if (pinned) return focusTaskInAgenda(pinned.dataset.goto);
  const info = target.closest('[data-open]');
  if (info) return openTaskInfo(info.dataset.open);
  const tut = target.closest('[data-tut]');
  if (tut) return openTutorial(...splitTutorialKey(tut.dataset.tut));
}

/**
 * Toque duplo em botões de tarefa: depois de uma ação o cartão é redesenhado e outro botão
 * (ex.: "Iniciar") pode aparecer no mesmo lugar do que foi tocado ("Agendar automático").
 * Um segundo toque logo em seguida é ignorado. (performance.now: não depende do relógio do sistema.)
 */
const TASK_ACTION_GUARD_MS = 700;
let lastTaskAction = null; // { id, at }
function isDoubleTap(btn) {
  // Botões de ação do cartão (data-a), ±15 min (data-d) e "aceitar" de tarefa aberta (data-claim).
  const id = 'a' in btn.dataset || 'd' in btn.dataset ? btn.dataset.i : btn.dataset.claim;
  if (id === undefined) {
    lastTaskAction = null; // outro botão no meio: foi intencional
    return false;
  }
  const now = performance.now();
  if (lastTaskAction && lastTaskAction.id === id && now - lastTaskAction.at < TASK_ACTION_GUARD_MS) return true;
  lastTaskAction = { id, at: now };
  return false;
}

async function onClick(e) {
  const btn = e.target.closest('button');
  try {
    if (!btn) return await onElementClick(e.target);
    if (isDoubleTap(btn)) return;
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
  lastTaskAction = null; // mexeu num campo (ex.: duração): o próximo toque é intencional
  try {
    if (x.id === 'af_c' || x.id === 'af_s') {
      ui.deviceFilter[x.id === 'af_c' ? 'cat' : 'status'] = x.value;
      x.blur();
      render();
    } else if (x.id === 'ag_d') {
      // Ir para a data: abre a visão (dia/semana/mês) no período dessa data.
      if (x.value) {
        ui.agendaDay = parseDateInput(x.value);
        x.blur();
        render();
      }
    } else if (x.id === 'selEmp') {
      ui.agendaEmp = x.value;
      render();
    } else if (x.id === 'f_v') {
      $('#f_kbox').innerHTML = problemPicker(x.value);
      $('#f_ebox').innerHTML = employeePicker(x.value);
      $('#f_rbox').innerHTML = recurrencePicker(x.value);
      $('#f_p').disabled = false;
    } else if (x.id === 'f_rc') {
      setRecurrenceOn(x.checked);
    } else if (x.classList.contains('m-role')) {
      await setMemberRole(x.dataset.id, x.value);
      say(nameOf(x.dataset.id) + ' agora é ' + ROLE_LABEL[x.value] + '.');
    } else if (x.classList.contains('m-cargo') && x.value) {
      await setMemberCargo(x.dataset.id, x.value);
      say('Função de ' + nameOf(x.dataset.id) + ' alterada.');
    } else if (x.classList.contains('cg-cat')) {
      await toggleCargoCategory(x.dataset.cargo, x.dataset.cgcat, x.checked);
    } else if (x.classList.contains('psel')) {
      ui.poolDur[x.dataset.i] = +x.value || 0;
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
  if (id === 'pb_n' || id === 'gr_n' || id === 'pb_en') {
    e.preventDefault();
    $({ pb_n: '#pb_add', gr_n: '#gr_ok', pb_en: '#pb_save' }[id]).click();
  } else if (!state.me && !state.uid && id.startsWith('a_') && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    $('#a_go')?.click();
  }
}

function initEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', (e) => { if (e.target.classList?.contains('cep-input')) onCepInput(e.target); });
  document.addEventListener('keydown', onKeyDown);
  // Fundo do modal e da gaveta lateral fecham ao tocar.
  $('#md').addEventListener('click', (e) => { if (e.target.id === 'md') closeModal(); });
  $('#ov').addEventListener('click', () => { openNotifications(false); openMenu(false); });
  initDrag();
  initDeviceDrag();
}
