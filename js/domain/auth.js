/* ==========================================================================
   Autenticação simulada no navegador, contas salvas e sincronização.

   - cred/<id>: { salt, hash, aid } — id = primeiros 24 hex do SHA-256 do e-mail.
   - A sessão é o "aid" salvo no localStorage (manter conectado) ou sessionStorage.
   ATENÇÃO: sem servidor, isto não é segurança real — ver CLAUDE.md.
   ========================================================================== */
'use strict';

const SESSION_KEY = 'aid';
const ACCOUNTS_KEY = 'accts';
const MAX_SAVED_ACCOUNTS = 8;

const credId = async (email) => (await sha256(email)).slice(0, 24);

async function getCredential(id) {
  const snap = await doc('cred/' + id).get().catch(() => null);
  return snap && snap.data();
}

/** Credencial do usuário logado, se `password` estiver correta; senão null. */
async function checkMyPassword(password) {
  const id = state.me.ck || state.uid;
  const cred = await getCredential(id);
  if (!cred || await hashPassword(password, cred.salt) !== cred.hash) return null;
  return { id, cred };
}

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
  const fail = (msg) => { ui.authMsg = msg; $('#a_m').textContent = msg; };

  if (!isValidEmail(email)) return fail('Informe um e-mail válido.');
  if (password.length < 6) return fail('A senha precisa ter ao menos 6 caracteres.');

  const id = await credId(email);
  const cred = await getCredential(id);

  if (ui.authMode === 'up') {
    const name = $('#a_n').value.trim();
    if (!name) return fail('Informe seu nome.');
    if (cred) return fail('Este e-mail já está cadastrado.');
    const salt = randomSalt();
    await doc('cred/' + id).set({ salt, hash: await hashPassword(password, salt) });
    await doc('profiles/' + id).set({ ...DEFAULT_SCHEDULE, name, role: $('#a_r').value, seen: 0, ck: id, email });
  } else if (!cred || await hashPassword(password, cred.salt) !== cred.hash) {
    return fail('E-mail ou senha incorretos.');
  }

  const aid = cred?.aid || id;
  if (ui.authMode !== 'up') await doc('profiles/' + aid).update({ ck: id, email }).catch(() => {});
  storage.set(SESSION_KEY, aid, $('#a_k').checked ? localStorage : sessionStorage);
  ui.authMsg = '';
  startSession(aid);
}

function stopSync() {
  ui.unsubscribers.forEach((off) => off());
  ui.unsubscribers = [];
}

function logout() {
  storage.remove(SESSION_KEY);
  storage.remove(SESSION_KEY, sessionStorage);
  stopSync();
  state.uid = null;
  resetSession();
  ui.authMode = 'in';
  render();
}

/** Troca para outra conta salva neste aparelho (sem pedir senha). */
function switchAccount(id) {
  [localStorage, sessionStorage].forEach((area) => {
    if (storage.get(SESSION_KEY, area)) storage.set(SESSION_KEY, id, area);
  });
  resetSession();
  openMenu(false);
  startSession(id);
  render();
}

// ---------- Conta ----------
async function changeEmail() {
  const email = $('#em_n').value.trim().toLowerCase();
  if (!isValidEmail(email)) return say('Informe um e-mail válido.');
  const ok = await checkMyPassword($('#em_p').value);
  if (!ok) return say('Senha atual incorreta.');
  const newId = await credId(email);
  if (newId !== ok.id && await getCredential(newId)) return say('Este e-mail já está em uso.');
  await doc('cred/' + newId).set({ salt: ok.cred.salt, hash: ok.cred.hash, aid: state.uid });
  if (newId !== ok.id) await doc('cred/' + ok.id).delete();
  await updateMyProfile({ ck: newId, email });
  say('E-mail alterado.');
}

async function changePassword() {
  const next = $('#pw_n').value;
  if (next.length < 6) return say('A nova senha precisa ter ao menos 6 caracteres.');
  const ok = await checkMyPassword($('#pw_c').value);
  if (!ok) return say('Senha atual incorreta.');
  const salt = randomSalt();
  await doc('cred/' + ok.id).update({ salt, hash: await hashPassword(next, salt) });
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
