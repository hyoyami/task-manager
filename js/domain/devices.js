/* ==========================================================================
   Aparelhos (da empresa), organização pessoal da Área de Trabalho e tutoriais.
   Categorias, funções e problemas ficam na empresa — ver domain/company.js.
   ========================================================================== */
'use strict';

const categoryOfDevice = (d) => categoryByName(d.area);

/** O usuário gerencia o aparelho na Área de Trabalho? (executa tarefas e a categoria é da função dele) */
const managesDevice = (profile, d) => executes(profile) && canSeeCategory(profile, d.area);

// ---------- Alerta de manutenção periódica ----------
const DAY = 24 * 60 * MIN;
/** Antecedência do alerta: metade do intervalo, no máximo 30 dias (a cada 2 meses → avisa faltando 1 mês). */
const ALERT_LEAD_MAX = 30 * DAY;

/**
 * Problemas periódicos da categoria (com aviso padrão) que o aparelho está para vencer sem nada marcado.
 * Conta a partir da última conclusão desse problema no aparelho (ou do cadastro do aparelho, se nunca foi feito).
 * Com uma tarefa aberta/programada desse problema para o aparelho, não há alerta.
 * @returns {{prob, rec, due, late}[]} do mais urgente para o menos
 */
function periodicAlerts(d) {
  const recs = state.company?.probRec?.[d.area] || {};
  const problems = problemsOf(d.area);
  const now = Date.now();
  const out = [];
  for (const [prob, rec] of Object.entries(recs)) {
    if (!problems.includes(prob)) continue;
    const related = allTasks().filter((t) => t.dev === d.id && t.preset === prob);
    if (related.some((t) => !FINISHED.includes(t.status))) continue; // já está marcado
    const done = related.filter((t) => t.status === 'concluida').map(finishedAt);
    const base = done.length ? Math.max(...done) : (d.created || now);
    const due = addRecurrence(base, rec);
    const lead = Math.min((due - startOfDay(base)) / 2, ALERT_LEAD_MAX);
    if (now >= due - lead) out.push({ prob, rec, due, late: now >= due });
  }
  return out.sort((a, b) => a.due - b.due);
}

/** "vence em 12 dias" / "vence hoje" / "atrasada desde 11/01/2027". */
function alertText(a) {
  if (a.late) return 'atrasada desde ' + new Date(a.due).toLocaleDateString('pt-BR');
  const days = Math.ceil((a.due - Date.now()) / DAY);
  return days <= 1 ? 'vence ' + (startOfDay(a.due) === startOfDay(Date.now()) ? 'hoje' : 'amanhã') : 'vence em ' + days + ' dias';
}

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

/** Atualiza a Área de Trabalho do perfil logado (mescla com a atual). */
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

/**
 * Troca nome, IP e/ou categoria do aparelho e registra no log o que mudou.
 * As tarefas abertas ligadas a ele (que o usuário pediu ou executa) passam a mostrar os dados novos.
 * Devolve false se nada mudou.
 */
async function updateDeviceData(id, { name, ip, area }) {
  const d = state.devices[id];
  if (!d) return false;
  const changes = [];
  const patch = {};
  if (name !== d.name) { changes.push('nome "' + d.name + '" → "' + name + '"'); patch.name = name; }
  if (ip !== (d.ip || '')) { changes.push('IP ' + (d.ip || '—') + ' → ' + ip); patch.ip = ip; }
  if (area !== d.area) { changes.push('categoria ' + d.area + ' → ' + area); patch.area = area; }
  if (!changes.length) return false;
  await addDeviceLog(id, 'Dados alterados: ' + changes.join('; ') + ' (por ' + nameOf(state.uid) + ')', patch);
  // Na organização de quem editou: sai do grupo da categoria antiga e vai para o da nova (criado, se não houver).
  if (patch.area && Array.isArray(state.me?.ws?.layout)) {
    const layout = myLayoutCopy();
    const where = locateDevice(layout, id);
    if (where?.group?.cat === d.area) {
      const at = layout.indexOf(where.group);
      const next = detachDevice(layout, id);
      const target = next.find((x) => x.type === 'group' && x.cat === area);
      if (target) target.items.unshift(id);
      else next.splice(at + 1, 0, { type: 'group', id: newGroupId(), name: area, cat: area, items: [id] });
      await saveLayout(next);
    }
  }
  const snapshot = { ...(patch.name ? { devName: name } : {}), ...(patch.ip ? { devIp: ip } : {}), ...(patch.area ? { devArea: area } : {}) };
  for (const t of allTasks().filter((x) => x.dev === id && !FINISHED.includes(x.status) && (x.emp === state.uid || x.req === state.uid))) {
    await silentTaskUpdate(t.id, snapshot);
  }
  return true;
}

async function deleteDevice(id) {
  delete state.myDevices[id];
  delete state.devices[id];
  await doc('devices/' + id).delete();
  // Remove também da organização salva (ver domain/layout.js).
  if (Array.isArray(state.me?.ws?.layout)) await saveLayout(myLayoutCopy());
}

/**
 * Anotação no log por quem não altera aparelhos (solicitante): função do banco que só acrescenta a
 * linha "Anotação de <nome>: <texto>", visível para todos no histórico do aparelho.
 */
async function addDeviceNoteAsMember(id, text) {
  const entry = await state.db.call('add_device_log', { dev_id: id, txt: text });
  const old = state.devices[id];
  if (old && entry) state.devices[id] = { ...old, log: [...(old.log || []), entry] }; // na hora, antes do tempo real
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
