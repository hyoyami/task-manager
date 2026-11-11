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
async function submitAuth() {
  const email = $('#a_e').value.trim().toLowerCase();
  const password = $('#a_p').value;
  const keep = $('#a_k').checked;
  const signup = ui.authMode === 'up';
  const fail = (msg) => { ui.authMsg = msg; $('#a_m').textContent = msg; };

  if (!isValidEmail(email)) return fail('Informe um e-mail válido.');
  if (password.length < 6) return fail('A senha precisa ter ao menos 6 caracteres.');
  const name = signup ? $('#a_n').value.trim() : '';
  const role = signup ? $('#a_r').value : '';
  if (signup && !name) return fail('Informe seu nome.');

  let id;
  try {
    id = signup ? await state.auth.signUp(email, password, keep) : await state.auth.signIn(email, password, keep);
  } catch (err) {
    return fail(err.message);
  }

  if (signup) await doc('profiles/' + id).set({ ...DEFAULT_SCHEDULE, name, role, seen: 0, ck: id, email });
  else await doc('profiles/' + id).update({ email }).catch(() => {});
  ui.authMsg = '';
  startSession(id);
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
  say('Senha alterada.');
}

// ---------- Sincronização em tempo real ----------
/** Assina as coleções do banco para a conta `aid`. */
function startSession(aid) {
  state.uid = aid;
  ui.knownNotifs = new Set();
  ui.notifsLoaded = false;
  stopSync();
  const db = state.db;
  const onError = (err) => console.error(err);

  ui.unsubscribers.push(
    db.collection('profiles').onSnapshot((snap) => {
      state.profiles = {};
      snap.docs.forEach((d) => { state.profiles[d.id] = { ...d.data(), id: d.id }; });
      state.me = state.profiles[state.uid] || null;
      // Sessão de uma conta que não existe mais neste banco.
      if (!state.me && snap.docs.length && state.uid) return logout();
      rememberAccount();
      if (state.me?.theme && state.me.theme !== currentTheme()) applyTheme(state.me.theme);
      render();
    }, onError),

    db.collection('tasks').onSnapshot((snap) => {
      state.tasks = {};
      snap.docs.forEach((d) => { state.tasks[d.id] = d.data(); });
      render();
    }, onError),

    db.collection('notifs').where('to', '==', aid).onSnapshot((snap) => {
      const list = snap.docs.map((d) => ({ ...d.data(), _id: d.id }));
      if (ui.notifsLoaded) {
        list.filter((n) => !ui.knownNotifs.has(n._id)).sort((a, b) => a.at - b.at).forEach(showPopup);
      }
      list.forEach((n) => ui.knownNotifs.add(n._id));
      ui.notifsLoaded = true;
      state.notifs = list;
      render();
    }, onError),

    db.collection('devices').onSnapshot((snap) => {
      state.devices = {};
      state.myDevices = {};
      snap.docs.forEach((d) => {
        const v = d.data();
        state.devices[d.id] = v;
        if (v.owner === state.uid) state.myDevices[d.id] = v;
      });
      render();
    }, (err) => { onError(err); say('Não foi possível carregar os aparelhos.'); }),

    db.collection('tutorials').onSnapshot((snap) => {
      state.tutorials = {};
      snap.docs.forEach((d) => { state.tutorials[d.id] = d.data(); });
      render();
    }, onError),
  );
}
