/* ==========================================================================
   Aparelhos (da empresa), organização pessoal da Workstation e tutoriais.
   Categorias, funções e problemas ficam na empresa — ver domain/company.js.
   ========================================================================== */
'use strict';

const categoryOfDevice = (d) => categoryByName(d.area);

/** O usuário gerencia o aparelho na Workstation? (executa tarefas e a categoria é da função dele) */
const managesDevice = (profile, d) => executes(profile) && canSeeCategory(profile, d.area);

/** Todas as categorias conhecidas na empresa (para os tutoriais). */
function allCategories() {
  const names = new Set(companyCategories().map((c) => c.name));
  Object.values(state.devices).forEach((d) => names.add(d.area));
  return [...names];
}

/** Todos os problemas de uma categoria, somando os tutoriais existentes. */
function allProblems(cat) {
  const names = new Set(problemsOf(cat));
  Object.values(state.tutorials).filter((x) => x.cat === cat).forEach((x) => names.add(x.prob));
  return [...names];
}

/** Atualiza a Workstation do perfil logado (mescla com a atual). */
async function updateWorkstation(patch) {
  const ws = { ...(state.me.ws || {}), ...patch };
  state.profiles[state.uid] = { ...state.profiles[state.uid], ws };
  state.me = state.profiles[state.uid];
  await updateMyProfile({ ws });
}

// ---------- Aparelhos ----------
async function createDevice({ name, ip, area }) {
  const ref = newDoc('devices');
  const now = Date.now();
  const device = {
    id: ref.id, company: state.me.company, owner: state.uid, name, ip, area, status: 'Operacional', created: now,
    log: [{ t: now, x: 'Aparelho cadastrado (IP ' + ip + ')' }],
  };
  state.devices[device.id] = state.myDevices[device.id] = device;
  await ref.set(device);
}

async function deleteDevice(id) {
  delete state.myDevices[id];
  delete state.devices[id];
  await doc('devices/' + id).delete();
  // Remove também da organização salva (ver domain/layout.js).
  if (Array.isArray(state.me?.ws?.layout)) await saveLayout(myLayoutCopy());
}

/** Acrescenta uma linha ao log do aparelho (e aplica `patch`, ex.: status). */
async function addDeviceLog(id, text, patch = {}) {
  const old = state.devices[id];
  if (!old) return;
  const updated = { ...old, ...patch, log: [...(old.log || []), { t: Date.now(), x: text }] };
  state.devices[id] = updated;
  if (state.myDevices[id]) state.myDevices[id] = updated;
  await doc('devices/' + id).update({ ...patch, log: updated.log });
}

// ---------- Tutoriais ----------
/** Passos do tutorial de (categoria, problema), em ordem. */
const tutorialSteps = (cat, prob) => Object.values(state.tutorials)
  .filter((x) => x.cat === cat && x.prob === prob)
  .sort((a, b) => a.order - b.order);

async function addTutorialStep(cat, prob, img, txt) {
  const ref = newDoc('tutorials');
  const step = { id: ref.id, company: state.me.company, cat, prob, order: Date.now(), img, txt, by: state.uid };
  state.tutorials[ref.id] = step;
  try {
    await ref.set(step);
  } catch (err) {
    delete state.tutorials[ref.id];
    throw err;
  }
}

async function deleteTutorialStep(id) {
  delete state.tutorials[id];
  await doc('tutorials/' + id).delete();
}

/** Troca a ordem do passo `id` com o vizinho (dir = -1 sobe, +1 desce). */
async function moveTutorialStep(cat, prob, id, dir) {
  const steps = tutorialSteps(cat, prob);
  const i = steps.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= steps.length) return;
  const a = steps[i];
  const b = steps[j];
  state.tutorials[a.id] = { ...a, order: b.order };
  state.tutorials[b.id] = { ...b, order: a.order };
  await Promise.all([
    doc('tutorials/' + a.id).update({ order: b.order }),
    doc('tutorials/' + b.id).update({ order: a.order }),
  ]);
}
