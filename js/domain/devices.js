/* ==========================================================================
   Aparelhos (Workstation), categorias, problemas de manutenção e tutoriais.

   Compatibilidade: perfis antigos podem ter `ws.areas` em vez de `ws.cats`.
   ========================================================================== */
'use strict';

/** Categorias próprias salvas no perfil (com fallback do formato antigo). */
const savedCategories = (ws) => (ws && (ws.cats || ws.areas)) || [];

/** Categorias visíveis do usuário logado: as do cargo + as criadas, menos as ocultas. */
function myCategories() {
  if (!state.me) return [];
  const ws = state.me.ws || {};
  const preset = (CARGOS[ws.cargo] || CARGOS.ti).cats;
  const own = savedCategories(ws).filter((o) => !preset.some((p) => p.name === o.name));
  return [...preset.map((c) => ({ ...c, id: c.name })), ...own]
    .filter((c) => !(ws.hidden || []).includes(c.name));
}

/** Categoria (com ícone) pelo nome, conforme o perfil do responsável. */
function categoryByName(owner, name) {
  const own = savedCategories(state.profiles[owner]?.ws);
  return own.find((c) => c.name === name && isDataUrl(c.icon))
    || CARGOS.ti.cats.find((c) => c.name === name)
    || own.find((c) => c.name === name)
    || null;
}

const categoryOfDevice = (d) => categoryByName(d.owner, d.area);

/** Todas as categorias conhecidas no sistema (para os tutoriais). */
function allCategories() {
  const names = new Set(CARGOS.ti.cats.map((c) => c.name));
  Object.values(state.profiles).forEach((p) => savedCategories(p.ws).forEach((c) => names.add(c.name)));
  Object.values(state.devices).forEach((d) => names.add(d.area));
  return [...names];
}

/** Problemas de manutenção de uma categoria (do perfil, ou os de fábrica). */
function problemsOf(ws, area) {
  const list = ws?.probs?.[area];
  return Array.isArray(list) ? list : (PRESETS[area] || []);
}

/** Todos os problemas de uma categoria, somando funcionários e tutoriais existentes. */
function allProblems(cat) {
  const names = new Set(PRESETS[cat] || []);
  employees().filter((p) => p.ws).forEach((p) => problemsOf(p.ws, cat).forEach((x) => names.add(x)));
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

const saveProblems = (area, list) =>
  updateWorkstation({ probs: { ...(state.me.ws?.probs || {}), [area]: list } });

// ---------- Aparelhos ----------
async function createDevice({ name, ip, area }) {
  const ref = newDoc('devices');
  const now = Date.now();
  const device = {
    id: ref.id, owner: state.uid, name, ip, area, status: 'Operacional', created: now,
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

/** Exclui a categoria (e seus aparelhos) e a oculta da lista. */
async function deleteCategory(name) {
  for (const d of Object.values(state.myDevices).filter((x) => x.area === name)) await deleteDevice(d.id);
  const ws = state.me.ws || {};
  await updateWorkstation({
    cats: savedCategories(ws).filter((c) => c.name !== name),
    hidden: [...new Set([...(ws.hidden || []), name])],
  });
}

// ---------- Tutoriais ----------
/** Passos do tutorial de (categoria, problema), em ordem. */
const tutorialSteps = (cat, prob) => Object.values(state.tutorials)
  .filter((x) => x.cat === cat && x.prob === prob)
  .sort((a, b) => a.order - b.order);

async function addTutorialStep(cat, prob, img, txt) {
  const ref = newDoc('tutorials');
  const step = { id: ref.id, cat, prob, order: Date.now(), img, txt, by: state.uid };
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
