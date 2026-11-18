/* ==========================================================================
   Empresa: criação, membros (pedidos de entrada, papéis, funções), convites,
   categorias de aparelho e problemas de manutenção.

   companies/<id> = {
     name, admin (uid), created,
     cats:   [{ name, icon }]          categorias criadas pela empresa (além das de fábrica),
     hidden: [nome]                    categorias de fábrica excluídas,
     probs:  { categoria: [problema] } problemas de manutenção (senão PRESETS),
     probRec: { categoria: { problema: {n, u} } }  aviso periódico padrão do problema (opcional),
     cargos: { chave: { n, cats: [categoria] } }  funções e as categorias que cada uma vê,
     addr, holidays                    endereço (CEP) e feriados da cidade — ver domain/holidays.js
   }
   invites/<código> = { company, role, by, created }   link: ?convite=<código>
   profiles/<id>: company, status ('pending' | 'active'), role, ws.cargo
   ========================================================================== */
'use strict';

const INVITE_PARAM = 'convite';
const PENDING_INVITE_KEY = 'tm_invite';

// ---------- Funções (cargos) e categorias ----------
/** Funções da empresa (padrão: TI vendo todas as categorias de fábrica). */
function companyCargos(company = state.company) {
  if (company?.cargos && Object.keys(company.cargos).length) return company.cargos;
  return { ti: { n: CARGOS.ti.n, cats: CARGOS.ti.cats.map((c) => c.name) } };
}

/** Todas as categorias da empresa: de fábrica (menos as excluídas) + as criadas. */
function companyCategories(company = state.company) {
  const hidden = company?.hidden || [];
  const own = (company?.cats || []).filter((c) => !CARGOS.ti.cats.some((p) => p.name === c.name));
  return [...CARGOS.ti.cats, ...own].filter((c) => !hidden.includes(c.name)).map((c) => ({ ...c, id: c.name }));
}

/** A pessoa enxerga a categoria? Admin e solicitante: todas; funcionário: as da sua função. */
function canSeeCategory(profile, cat) {
  if (!profile || profile.role !== 'func') return true;
  const cargo = companyCargos()[profile.ws?.cargo];
  return !cargo || (cargo.cats || []).includes(cat);
}

/** Categorias visíveis para o usuário logado (as da função, para o funcionário). */
const myCategories = () => companyCategories().filter((c) => canSeeCategory(state.me, c.name));

/** Categoria (com ícone) pelo nome. */
function categoryByName(name) {
  return companyCategories().find((c) => c.name === name) || null;
}

/** Problemas de manutenção da categoria (os da empresa, ou os de fábrica). */
function problemsOf(area) {
  const list = state.company?.probs?.[area];
  return Array.isArray(list) ? list : (PRESETS[area] || []);
}

/** Funcionários (e o administrador) que atendem aparelhos da categoria. */
const eligibleEmployees = (area) => employees().filter((p) => canSeeCategory(p, area));

// ---------- Alterações da empresa (administrador) ----------
async function updateCompany(patch) {
  const id = state.company.id;
  state.company = { ...state.company, ...patch };
  await doc('companies/' + id).update(patch);
}

const renameCompany = (name) => updateCompany({ name });

/** Empresa recém-criada ainda na configuração inicial (empresas antigas não têm o campo: já prontas). */
const needsCompanySetup = () => isAdmin() && state.company?.setup === false;
const finishCompanySetup = () => updateCompany({ setup: true });
const saveProblems = (area, list) => updateCompany({ probs: { ...(state.company.probs || {}), [area]: list } });

/** Aviso periódico padrão do problema ({n, u}) ou null. */
const problemRecurrence = (area, name) => state.company?.probRec?.[area]?.[name] || null;

/**
 * Edita o problema `index` da categoria: novo nome e aviso periódico (null = sem aviso).
 * Renomear leva junto os passos do tutorial desse problema.
 */
async function saveProblem(area, index, name, rec) {
  const list = [...problemsOf(area)];
  const old = list[index];
  if (old === undefined) return;
  list[index] = name;
  const recs = { ...(state.company.probRec?.[area] || {}) };
  delete recs[old];
  if (rec) recs[name] = rec;
  await updateCompany({
    probs: { ...(state.company.probs || {}), [area]: list },
    probRec: { ...(state.company.probRec || {}), [area]: recs },
  });
  if (name !== old) {
    for (const step of Object.values(state.tutorials).filter((x) => x.cat === area && x.prob === old)) {
      state.tutorials[step.id] = { ...step, prob: name };
      await doc('tutorials/' + step.id).update({ prob: name });
    }
  }
}

/** Exclui o problema `index` da categoria (e o aviso dele). */
async function deleteProblem(area, index) {
  const list = problemsOf(area);
  const recs = { ...(state.company.probRec?.[area] || {}) };
  delete recs[list[index]];
  await updateCompany({
    probs: { ...(state.company.probs || {}), [area]: list.filter((_, i) => i !== +index) },
    probRec: { ...(state.company.probRec || {}), [area]: recs },
  });
}

/** Nova categoria (com ícone PNG); passa a valer para todas as funções. */
async function addCategory(name, icon) {
  const cargos = companyCargos();
  const next = {};
  Object.entries(cargos).forEach(([k, v]) => { next[k] = { ...v, cats: [...new Set([...(v.cats || []), name])] }; });
  await updateCompany({
    cats: [...(state.company.cats || []).filter((c) => c.name !== name), { name, icon }],
    hidden: (state.company.hidden || []).filter((h) => h !== name),
    cargos: next,
  });
}

/** Exclui a categoria (e os aparelhos dela). */
async function deleteCategory(name) {
  for (const d of Object.values(state.devices).filter((x) => x.area === name)) await deleteDevice(d.id);
  const isPreset = CARGOS.ti.cats.some((c) => c.name === name);
  await updateCompany({
    cats: (state.company.cats || []).filter((c) => c.name !== name),
    hidden: isPreset ? [...new Set([...(state.company.hidden || []), name])] : (state.company.hidden || []),
  });
}

const cargoKey = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function addCargo(name) {
  const key = cargoKey(name);
  const cargos = companyCargos();
  if (!key || cargos[key]) throw new Error('Essa função já existe.');
  await updateCompany({ cargos: { ...cargos, [key]: { n: name, cats: [] } } });
}

/** Liga/desliga a categoria na função. */
async function toggleCargoCategory(key, cat, on) {
  const cargos = companyCargos();
  const cats = new Set(cargos[key]?.cats || []);
  if (on) cats.add(cat); else cats.delete(cat);
  await updateCompany({ cargos: { ...cargos, [key]: { ...cargos[key], cats: [...cats] } } });
}

async function deleteCargo(key) {
  const cargos = { ...companyCargos() };
  delete cargos[key];
  await updateCompany({ cargos });
}

// ---------- Entrar numa empresa ----------
/** Cria a empresa e torna o usuário logado o administrador dela. */
async function createCompany(name, addr) {
  const ref = newDoc('companies');
  const cargos = companyCargos(null);
  // setup:false → o administrador passa pela etapa "Aparelhos da empresa" antes de entrar no sistema.
  await ref.set({ id: ref.id, name, admin: state.uid, created: Date.now(), cats: [], hidden: [], probs: {}, cargos, setup: false,
    ...(addr ? { addr } : {}) });
  await updateMyProfile({ company: ref.id, status: 'active', role: 'admin' });
}

/** Pede para entrar na empresa (fica pendente até o administrador aceitar). */
const requestJoin = (companyId, role) => updateMyProfile({ company: companyId, status: 'pending', role, requestedAt: Date.now() });

/** Cancela o pedido (ou sai da empresa). */
const leaveCompany = () => updateMyProfile({ company: null, status: null });

/** Entra pela chave do link de convite (validado no banco). */
async function joinWithInvite(code) {
  await state.db.call('join_with_invite', { code });
}

// ---------- Membros (administrador) ----------
const updateMember = (id, patch) => doc('profiles/' + id).update(patch);

async function acceptMember(id, role, cargo) {
  await updateMember(id, { status: 'active', role, ...(role === 'func' && cargo ? { ws: { ...(state.joinRequests.find((p) => p.id === id)?.ws || {}), cargo, setup: true } } : {}) });
  notify(id, 'Seu pedido para entrar em ' + state.company.name + ' foi aceito. Bem-vindo(a)!');
}

const rejectMember = (id) => updateMember(id, { company: null, status: null });
const removeMember = (id) => updateMember(id, { company: null, status: null });
const setMemberRole = (id, role) => updateMember(id, { role });
const setMemberCargo = (id, cargo) => updateMember(id, { ws: { ...(state.profiles[id]?.ws || {}), cargo, setup: true } });

// ---------- Convites ----------
function newInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

async function createInvite(role) {
  const code = newInviteCode();
  await doc('invites/' + code).set({ company: state.company.id, role, by: state.uid, created: Date.now() });
  return code;
}

const deleteInvite = (code) => doc('invites/' + code).delete();

/** Link de convite: a página atual + ?convite=<código> (mantém outros parâmetros, ex.: backend). */
function inviteLink(code) {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.set(INVITE_PARAM, code);
  return url.toString();
}

/** Guarda o convite da URL até o usuário entrar/cadastrar (e o tira da barra de endereço). */
function captureInviteFromUrl() {
  const url = new URL(location.href);
  const code = url.searchParams.get(INVITE_PARAM);
  if (!code) return;
  storage.set(PENDING_INVITE_KEY, code, sessionStorage);
  url.searchParams.delete(INVITE_PARAM);
  history.replaceState(null, '', url.toString());
}

const pendingInvite = () => storage.get(PENDING_INVITE_KEY, sessionStorage);
const clearPendingInvite = () => storage.remove(PENDING_INVITE_KEY, sessionStorage);
