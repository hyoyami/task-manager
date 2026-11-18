/* ==========================================================================
   Login, contas salvas e sincronização em tempo real.

   O login é feito pelo adaptador `state.auth` (claude.use('auth')), fornecido
   pelo back-end ativo — Supabase Auth em produção ou o login simulado do modo
   local (js/runtime/). O id da conta (state.uid) é o id do perfil em profiles/.
   ========================================================================== */
'use strict';

const ACCOUNTS_KEY = 'accts';
const MAX_SAVED_ACCOUNTS = 8;

// ---------- Contas salvas neste aparelho ----------
function savedAccounts() {
  try { return JSON.parse(storage.get(ACCOUNTS_KEY) || '[]'); } catch (_) { return []; }
}
const setSavedAccounts = (list) => storage.set(ACCOUNTS_KEY, JSON.stringify(list));

function rememberAccount() {
  if (!state.me || !state.uid) return;
  const list = savedAccounts().filter((a) => a.id !== state.uid);
  list.unshift({ id: state.uid, name: state.me.name, role: state.me.role });
  setSavedAccounts(list.slice(0, MAX_SAVED_ACCOUNTS));
}

const forgetAccount = (id) => setSavedAccounts(savedAccounts().filter((a) => a.id !== id));

// ---------- Entrar / cadastrar / sair ----------
/** Lê o formulário de login, valida e inicia a sessão. */
/** O nome de usuário está livre? (`exceptId`: ignora o próprio perfil ao trocar o nome) */
async function usernameAvailable(username, exceptId) {
  if (exceptId && normalizeUsername(state.profiles[exceptId]?.username) === username) return true;
  return state.db.call('username_available', { uname: username });
}

async function submitAuth() {
  const login = $('#a_e').value.trim().toLowerCase(); // no cadastro: e-mail; ao entrar: e-mail ou nome de usuário
  const password = $('#a_p').value;
  const keep = $('#a_k').checked;
  const signup = ui.authMode === 'up';
  const fail = (msg) => { ui.authMsg = msg; $('#a_m').textContent = msg; };
  const byEmail = login.includes('@');

  if (signup || byEmail) {
    if (!isValidEmail(login)) return fail('Informe um e-mail válido.');
  } else if (!isValidUsername(login)) {
    return fail('Informe seu e-mail ou nome de usuário.');
  }
  if (password.length < 6) return fail('A senha precisa ter ao menos 6 caracteres.');
  const name = signup ? $('#a_n').value.trim() : '';
  const username = signup ? normalizeUsername($('#a_u').value) : '';
  if (signup && !name) return fail('Informe seu nome.');
  if (signup && !isValidUsername(username)) return fail(USERNAME_RULE);

  let id;
  try {
    if (signup && !(await usernameAvailable(username))) return fail('Este nome de usuário já está em uso.');
    id = signup ? await state.auth.signUp(login, password, keep, { name, username }) : await state.auth.signIn(login, password, keep);
  } catch (err) {
    if (err.code === 'unconfirmed') return showConfirmEmail(err.email);
    return fail(err.message);
  }
  // Confirmação de e-mail ligada: a conta (e o perfil, criado pelo banco) existe, mas só entra depois do link.
  if (id && id.pending) return showConfirmEmail(login);

  // Papel e empresa são definidos depois: criando uma empresa, pedindo entrada ou por convite.
  if (signup) {
    try {
      await doc('profiles/' + id).set({ ...DEFAULT_SCHEDULE, name, username, role: null, company: null, status: null, seen: 0, ck: id, email: login });
    } catch (err) {
      // Outra pessoa pegou o mesmo nome entre a checagem e o cadastro (o banco garante que é único).
      await state.auth.signOut().catch(() => {});
      return fail(/duplicate|unique|username/i.test(err.message) ? 'Este nome de usuário já está em uso.' : err.message);
    }
  } else if (byEmail) {
    await doc('profiles/' + id).update({ email: login }).catch(() => {});
  }
  ui.authMsg = '';
  clearDraft();
  startSession(id);
}

/** Tela "Confirme seu e-mail" (cadastro feito, falta abrir o link). */
function showConfirmEmail(email) {
  ui.authMode = 'check';
  ui.pendingEmail = email;
  ui.authMsg = '';
  render();
}

async function resendConfirmation(btn) {
  btn.disabled = true;
  try {
    await state.auth.resendConfirmation(ui.pendingEmail);
    say('Enviamos um novo link para ' + ui.pendingEmail + '.');
  } catch (err) {
    say(err.message);
  } finally {
    btn.disabled = false;
  }
}

function stopSync() {
  ui.unsubscribers.forEach((off) => off());
  ui.unsubscribers = [];
}

/** Volta para a tela de login sem encerrar a sessão no back-end. */
function showLogin() {
  stopSync();
  state.uid = null;
  resetSession();
  ui.authMode = 'in';
  render();
}

async function logout() {
  await state.auth.signOut().catch((err) => console.warn(err));
  showLogin();
}

/** "Entrar com outra conta": a conta atual continua salva para "Trocar de conta". */
async function addAnotherAccount() {
  await state.auth.detach();
  showLogin();
}

/** Troca para outra conta salva neste aparelho (sem pedir senha). */
async function switchAccount(id) {
  openMenu(false);
  if (!(await state.auth.resume(id))) {
    forgetAccount(id);
    say('Sessão dessa conta expirou. Entre novamente com ela.');
    return addAnotherAccount();
  }
  resetSession();
  startSession(id);
  render();
}

// ---------- Conta ----------
async function changeEmail() {
  const email = $('#em_n').value.trim().toLowerCase();
  if (!isValidEmail(email)) return say('Informe um e-mail válido.');
  let result;
  try {
    result = await state.auth.changeEmail(email, $('#em_p').value);
  } catch (err) {
    return say(err.message);
  }
  if (result?.pending) return say('Enviamos um link ao novo e-mail. A troca vale após a confirmação.');
  await updateMyProfile({ email });
  clearFields('em_n', 'em_p');
  say('E-mail alterado.');
}

async function changePassword() {
  const next = $('#pw_n').value;
  if (next.length < 6) return say('A nova senha precisa ter ao menos 6 caracteres.');
  try {
    await state.auth.changePassword($('#pw_c').value, next);
  } catch (err) {
    return say(err.message);
  }
  clearFields('pw_c', 'pw_n');
  say('Senha alterada.');
}

// ---------- Sincronização em tempo real ----------
/** Último conteúdo recebido de cada coleção (antes do filtro por empresa). */
const raw = { profiles: {}, companies: {}, invites: {}, tasks: {}, devices: {}, tutorials: {}, notifs: [] };

/**
 * Recalcula o estado visível a partir do que chegou do banco, limitado à empresa do usuário.
 * (No Supabase o RLS já faz esse filtro no servidor; no modo local, é aqui que ele acontece.)
 */
function applyCompanyScope() {
  const me = raw.profiles[state.uid] || null;
  const companyId = me?.status === 'active' ? me.company : null;
  const inCompany = (x) => !!companyId && x.company === companyId;
  const pick = (map) => Object.fromEntries(Object.entries(map).filter(([, v]) => inCompany(v)));

  state.me = me;
  state.companies = raw.companies;
  state.company = companyId && raw.companies[companyId] ? { ...raw.companies[companyId], id: companyId } : null;
  state.profiles = Object.fromEntries(Object.values(raw.profiles)
    .filter((p) => p.id === state.uid || (inCompany(p) && p.status === 'active'))
    .map((p) => [p.id, p]));
  state.joinRequests = me?.role === 'admin'
    ? Object.values(raw.profiles).filter((p) => inCompany(p) && p.status === 'pending').sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0))
    : [];
  state.invites = me?.role === 'admin' ? pick(raw.invites) : {};
  state.tasks = pick(raw.tasks);
  state.devices = pick(raw.devices);
  state.myDevices = Object.fromEntries(Object.entries(state.devices).filter(([, d]) => managesDevice(me, d)));
  state.tutorials = pick(raw.tutorials);
  state.notifs = raw.notifs.filter((n) => !n.company || inCompany(n));
}

/** Convite pendente (link aberto antes de entrar): usa assim que o perfil carregar. */
let joiningInvite = false;
async function usePendingInvite() {
  const code = pendingInvite();
  if (!code || joiningInvite || !state.me) return;
  if (state.me.status === 'active' && state.me.company) {
    clearPendingInvite();
    return say('Você já participa de uma empresa; o convite foi ignorado.');
  }
  joiningInvite = true;
  try {
    await joinWithInvite(code);
    say('Convite aceito! Você entrou na empresa.');
  } catch (err) {
    console.warn(err);
    say('Convite inválido ou expirado. Peça um novo link ao administrador.');
  } finally {
    clearPendingInvite();
    joiningInvite = false;
  }
}

/** Assina as coleções do banco para a conta `aid`. */
function startSession(aid) {
  state.uid = aid;
  ui.scopeKey = undefined;
  ui.knownNotifs = new Set();
  ui.notifsLoaded = false;
  stopSync();
  // Mesma conta reassinando (entrou/saiu de empresa): mantém o que está na tela até os dados novos
  // chegarem, para não piscar "Carregando…" nem perder o que a pessoa estava preenchendo.
  if (raw.uid !== aid) {
    Object.assign(raw, { uid: aid, profiles: {}, companies: {}, invites: {}, tasks: {}, devices: {}, tutorials: {}, notifs: [] });
  }
  const db = state.db;
  const onError = (err) => console.error(err);
  const refresh = () => { applyCompanyScope(); render(); };
  const mapOf = (snap, withId) => Object.fromEntries(snap.docs.map((d) => [d.id, withId ? { ...d.data(), id: d.id } : d.data()]));

  ui.unsubscribers.push(
    db.collection('profiles').onSnapshot((snap) => {
      raw.profiles = mapOf(snap, true);
      // Sessão de uma conta que não existe mais neste banco (ex.: conta apagada): volta ao login.
      if (!raw.profiles[state.uid] && state.uid) return logout();
      // Entrou, saiu ou foi aprovado numa empresa: o que o banco deixa ver mudou → recarrega tudo.
      const me = raw.profiles[state.uid];
      const scopeKey = me ? (me.status || '') + '|' + (me.company || '') : '';
      if (ui.scopeKey !== undefined && scopeKey !== ui.scopeKey) return startSession(state.uid);
      ui.scopeKey = scopeKey;
      applyCompanyScope();
      rememberAccount();
      if (state.me?.theme && state.me.theme !== currentTheme()) applyTheme(state.me.theme);
      render();
      usePendingInvite();
    }, onError),

    db.collection('companies').onSnapshot((snap) => { raw.companies = mapOf(snap, true); refresh(); syncHolidays(); }, onError),
    db.collection('invites').onSnapshot((snap) => { raw.invites = mapOf(snap, true); refresh(); }, onError),
    db.collection('tasks').onSnapshot((snap) => { raw.tasks = mapOf(snap); refresh(); activateDueTasks(); reflowPausedTasks(); }, onError),

    db.collection('notifs').where('to', '==', aid).onSnapshot((snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
      if (ui.notifsLoaded) {
        list.filter((n) => !ui.knownNotifs.has(n._id)).sort((a, b) => a.at - b.at).forEach(showPopup);
      }
      list.forEach((n) => ui.knownNotifs.add(n._id));
      ui.notifsLoaded = true;
      raw.notifs = list;
      refresh();
    }, onError),

    db.collection('devices').onSnapshot((snap) => { raw.devices = mapOf(snap); refresh(); },
      (err) => { onError(err); say('Não foi possível carregar os aparelhos.'); }),

    db.collection('tutorials').onSnapshot((snap) => { raw.tutorials = mapOf(snap); refresh(); }, onError),
  );
}
