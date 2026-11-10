/* ==========================================================================
   Organização dos aparelhos (ordem e grupos), definida pelo funcionário na
   Workstation e exibida igual para o solicitante na aba Aparelhos.

   Guardada no perfil do responsável: profiles/<id>.ws.layout = [
     { type: 'dev',   id },                               aparelho solto
     { type: 'group', id, name, cat?, items: [devId…] }   grupo (cat = criado da categoria)
   ]
   Sem layout salvo, cada categoria vira um grupo (visual original da Workstation).
   Aparelhos novos entram no grupo da sua categoria, se existir, ou no fim.
   ========================================================================== */
'use strict';

const devicesOf = (owner) => Object.values(state.devices).filter((d) => d.owner === owner);
const topKey = (item) => (item.type === 'group' ? 'g:' : 'd:') + item.id;
const newGroupId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Categorias na ordem de exibição: as do cargo, as criadas e as que só aparecem em aparelhos. */
function categoryOrder(ws, devices) {
  const preset = (CARGOS[ws?.cargo] || CARGOS.ti).cats.map((c) => c.name);
  return [...new Set([...preset, ...savedCategories(ws).map((c) => c.name), ...devices.map((d) => d.area)])];
}

function defaultLayout(owner) {
  const ws = state.profiles[owner]?.ws;
  const devices = devicesOf(owner).sort((a, b) => b.created - a.created);
  return categoryOrder(ws, devices)
    .map((cat) => ({ type: 'group', id: 'cat:' + cat, name: cat, cat, items: devices.filter((d) => d.area === cat).map((d) => d.id) }))
    .filter((g) => g.items.length);
}

/** Organização atual dos aparelhos de `owner`, já conciliada com os aparelhos existentes. */
function deviceLayout(owner) {
  const saved = state.profiles[owner]?.ws?.layout;
  if (!Array.isArray(saved)) return defaultLayout(owner);

  const devices = devicesOf(owner);
  const exists = new Set(devices.map((d) => d.id));
  const placed = new Set();
  const take = (id) => (exists.has(id) && !placed.has(id) ? (placed.add(id), true) : false);

  const layout = [];
  for (const item of saved) {
    if (item.type === 'group') layout.push({ ...item, items: (item.items || []).filter(take) });
    else if (item.type === 'dev' && take(item.id)) layout.push({ type: 'dev', id: item.id });
  }
  // Aparelhos ainda não posicionados (cadastrados depois da última organização).
  devices.filter((d) => !placed.has(d.id)).sort((a, b) => a.created - b.created).forEach((d) => {
    const group = layout.find((x) => x.type === 'group' && x.cat === d.area);
    if (group) group.items.unshift(d.id);
    else layout.push({ type: 'dev', id: d.id });
  });
  return layout.filter((x) => x.type !== 'group' || x.items.length);
}

// ---------- Alterações (sempre na organização do usuário logado) ----------
const myLayoutCopy = () => deviceLayout(state.uid).map((x) => (x.type === 'group' ? { ...x, items: [...x.items] } : { ...x }));

async function saveLayout(layout) {
  await updateWorkstation({ layout: layout.filter((x) => x.type !== 'group' || x.items.length) });
}

/** Tira o aparelho de onde estiver. */
function detachDevice(layout, id) {
  layout.forEach((x) => { if (x.type === 'group') x.items = x.items.filter((d) => d !== id); });
  return layout.filter((x) => !(x.type === 'dev' && x.id === id));
}

/** Onde está o aparelho: { group, index } (group null = solto, index no nível de cima). */
function locateDevice(layout, id) {
  for (let i = 0; i < layout.length; i++) {
    const x = layout[i];
    if (x.type === 'dev' && x.id === id) return { group: null, index: i };
    if (x.type === 'group') {
      const j = x.items.indexOf(id);
      if (j >= 0) return { group: x, index: j };
    }
  }
  return null;
}

function nextGroupName(layout) {
  const names = new Set(layout.filter((x) => x.type === 'group').map((x) => x.name));
  let n = 1;
  while (names.has('Grupo ' + n)) n++;
  return 'Grupo ' + n;
}

/**
 * Move um aparelho. Destinos:
 *   { kind: 'before'|'after', ref }  ao lado do aparelho `ref`
 *   { kind: 'combine', ref }         sobre `ref`: cria grupo (ou entra no grupo de `ref`)
 *   { kind: 'group', groupId }       no fim do grupo
 *   { kind: 'root' }                 fora dos grupos, no fim
 * Devolve o grupo criado, se houver.
 */
async function moveDevice(id, target) {
  if (target.ref === id) return null;
  const layout = detachDevice(myLayoutCopy(), id);
  let created = null;

  if (target.kind === 'root') {
    layout.push({ type: 'dev', id });
  } else if (target.kind === 'group') {
    const group = layout.find((x) => x.type === 'group' && x.id === target.groupId);
    if (!group) return null;
    group.items.push(id);
  } else {
    const loc = locateDevice(layout, target.ref);
    if (!loc) return null;
    const offset = target.kind === 'before' ? 0 : 1;
    if (loc.group) {
      loc.group.items.splice(loc.index + offset, 0, id);
    } else if (target.kind === 'combine') {
      created = { type: 'group', id: newGroupId(), name: nextGroupName(layout), items: [target.ref, id] };
      layout[loc.index] = created;
    } else {
      layout.splice(loc.index + offset, 0, { type: 'dev', id });
    }
  }
  await saveLayout(layout);
  return created;
}

/** Move um grupo para antes/depois de outro item do nível de cima ({ kind, key } ou { kind: 'end' }). */
async function moveGroup(groupId, target) {
  const layout = myLayoutCopy();
  const from = layout.findIndex((x) => x.type === 'group' && x.id === groupId);
  if (from < 0) return;
  const [group] = layout.splice(from, 1);
  const to = target.kind === 'end' ? -1 : layout.findIndex((x) => topKey(x) === target.key);
  if (to < 0) layout.push(group);
  else layout.splice(to + (target.kind === 'after' ? 1 : 0), 0, group);
  await saveLayout(layout);
}

async function renameGroup(groupId, name) {
  const layout = myLayoutCopy();
  const group = layout.find((x) => x.type === 'group' && x.id === groupId);
  if (!group) return;
  group.name = name;
  await saveLayout(layout);
}

/** Desfaz o grupo: os aparelhos ficam soltos, no mesmo lugar. */
async function ungroup(groupId) {
  const layout = myLayoutCopy();
  const i = layout.findIndex((x) => x.type === 'group' && x.id === groupId);
  if (i < 0) return;
  layout.splice(i, 1, ...layout[i].items.map((id) => ({ type: 'dev', id })));
  await saveLayout(layout);
}

const findGroup = (owner, groupId) => deviceLayout(owner).find((x) => x.type === 'group' && x.id === groupId);

// ---------- Aba Aparelhos do solicitante: só a ordem das categorias ----------
/**
 * Ordena categorias conforme a preferência do solicitante (profiles/<id>.devCatOrder);
 * as que ainda não foram posicionadas seguem a ordem do cargo e depois a alfabética.
 */
function requesterCategoryOrder(cats) {
  const saved = state.me?.devCatOrder || [];
  const preset = CARGOS.ti.cats.map((c) => c.name);
  const rank = (c) => {
    const i = saved.indexOf(c);
    if (i >= 0) return i;
    const p = preset.indexOf(c);
    return saved.length + (p >= 0 ? p : preset.length);
  };
  return [...cats].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Move a categoria para antes/depois de outra ({ kind, key: 'g:<categoria>' } ou { kind: 'end' }). */
async function moveCategory(name, target) {
  const order = requesterCategoryOrder(new Set(Object.values(state.devices).map((d) => d.area))).filter((c) => c !== name);
  const to = target.kind === 'end' ? -1 : order.findIndex((c) => 'g:' + c === target.key);
  if (to < 0) order.push(name);
  else order.splice(to + (target.kind === 'after' ? 1 : 0), 0, name);
  await patchMyProfile({ devCatOrder: order });
}
