/* ==========================================================================
   Banco de dados local do TASK MANAGER.

   Emula a API `claude.use('db')` / `claude.use('user')` do claude.ai e guarda
   tudo no localStorage deste navegador (chave `tm_db_v1`). As alterações feitas
   em outra aba do mesmo navegador são sincronizadas pelo evento `storage`.

   API suportada (subconjunto no estilo Firestore):
     db.collection(nome).doc([id])       → referência (id gerado se omitido)
     db.collection(nome).where(campo, '==', valor).onSnapshot(cb)
     db.collection(nome).onSnapshot(cb)  → devolve função para cancelar
     db.doc('colecao/id').set|update|delete|get()

   Login simulado (claude.use('auth')): credenciais em cred/<id> com PBKDF2,
   id = primeiros 24 hex do SHA-256 do e-mail; sessão = "aid" no localStorage
   (manter conectado) ou no sessionStorage. Sem servidor, NÃO é segurança real:
   serve para desenvolvimento e testes. Em produção use o Supabase (config.js).
   ========================================================================== */
(function () {
  'use strict';
  var cfg = window.TM_CONFIG;
  if (cfg && cfg.backend !== 'local') return;

  var KEY = 'tm_db_v1';
  var store = {};
  var listeners = new Set();

  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }

  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { alert('Armazenamento do navegador cheio.'); }
  }

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // Mudanças feitas em outra aba.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    try { store = JSON.parse(e.newValue || '{}'); } catch (_) { /* mantém o atual */ }
    emit();
  });

  function docRef(path) {
    var id = path.split('/').pop();
    return {
      id: id,
      path: path,
      set: async function (data) { store[path] = clone(data); save(); emit(); },
      update: async function (patch) {
        if (!store[path]) throw new Error('Documento não existe: ' + path);
        store[path] = Object.assign({}, store[path], clone(patch));
        save();
        emit();
      },
      delete: async function () { delete store[path]; save(); emit(); },
      get: async function () {
        return { exists: !!store[path], id: id, data: function () { return clone(store[path]); } };
      },
    };
  }

  function collectionRef(name, filter) {
    var prefix = name + '/';
    return {
      doc: function (id) { return docRef(prefix + (id || newId())); },
      // Só o operador '==' é suportado.
      where: function (field, op, value) {
        return collectionRef(name, function (d) { return d[field] === value; });
      },
      onSnapshot: function (callback) {
        var run = function () {
          var docs = Object.keys(store)
            .filter(function (k) { return k.indexOf(prefix) === 0 && (!filter || filter(store[k])); })
            .map(function (k) {
              return { id: k.slice(prefix.length), data: function () { return clone(store[k]); } };
            });
          callback({ docs: docs });
        };
        listeners.add(run);
        setTimeout(run, 0);
        return function () { listeners.delete(run); };
      },
    };
  }

  var db = {
    collection: function (name) { return collectionRef(name); },
    doc: function (path) { return docRef(path); },
  };

  var user = { id: async function () { return 'local'; } };

  // ---------- Login simulado ----------
  // Usa sha256/hashPassword/randomSalt de js/core/utils.js (carregado depois; só chamado em tempo de execução).
  var SESSION = 'aid';
  var currentAid = null;

  function sessionAreas() { return [localStorage, sessionStorage]; }
  function readAid() {
    try { return localStorage.getItem(SESSION) || sessionStorage.getItem(SESSION); } catch (e) { return null; }
  }
  function writeAid(id, keep) {
    try { (keep ? localStorage : sessionStorage).setItem(SESSION, id); } catch (e) { /* modo privado */ }
  }
  function clearAid() {
    sessionAreas().forEach(function (a) { try { a.removeItem(SESSION); } catch (e) { /* ignorado */ } });
  }
  async function credIdOf(email) { return (await sha256(email)).slice(0, 24); }
  function credOf(id) { return store['cred/' + id]; }
  async function matches(cred, password) { return !!cred && (await hashPassword(password, cred.salt)) === cred.hash; }
  /** Id da credencial do usuário logado (muda quando ele troca de e-mail). */
  function myCredId() { var p = store['profiles/' + currentAid] || {}; return p.ck || currentAid; }

  var auth = {
    kind: 'local',
    restore: async function () { currentAid = readAid(); return currentAid; },
    signUp: async function (email, password, keep) {
      var id = await credIdOf(email);
      if (credOf(id)) throw new Error('Este e-mail já está cadastrado.');
      var salt = randomSalt();
      await docRef('cred/' + id).set({ salt: salt, hash: await hashPassword(password, salt) });
      writeAid(id, keep);
      return (currentAid = id);
    },
    signIn: async function (email, password, keep) {
      var id = await credIdOf(email);
      var cred = credOf(id);
      if (!(await matches(cred, password))) throw new Error('E-mail ou senha incorretos.');
      var aid = cred.aid || id;
      if (store['profiles/' + aid]) await docRef('profiles/' + aid).update({ ck: id });
      writeAid(aid, keep);
      return (currentAid = aid);
    },
    signOut: async function () { clearAid(); currentAid = null; },
    detach: async function () { clearAid(); currentAid = null; },
    resume: async function (id) {
      var any = false;
      sessionAreas().forEach(function (a) {
        try { if (a.getItem(SESSION)) { a.setItem(SESSION, id); any = true; } } catch (e) { /* ignorado */ }
      });
      if (!any) writeAid(id, false);
      currentAid = id;
      return true;
    },
    changeEmail: async function (email, password) {
      var ck = myCredId();
      var cred = credOf(ck);
      if (!(await matches(cred, password))) throw new Error('Senha atual incorreta.');
      var next = await credIdOf(email);
      if (next !== ck && credOf(next)) throw new Error('Este e-mail já está em uso.');
      await docRef('cred/' + next).set({ salt: cred.salt, hash: cred.hash, aid: currentAid });
      if (next !== ck) await docRef('cred/' + ck).delete();
      await docRef('profiles/' + currentAid).update({ ck: next });
      return { pending: false };
    },
    changePassword: async function (current, next) {
      var ck = myCredId();
      if (!(await matches(credOf(ck), current))) throw new Error('Senha atual incorreta.');
      var salt = randomSalt();
      await docRef('cred/' + ck).update({ salt: salt, hash: await hashPassword(next, salt) });
    },
  };

  window.claude = {
    use: async function (name) {
      if (name === 'db') return db;
      if (name === 'auth') return auth;
      if (name === 'user') return user;
      return null;
    },
  };
})();
