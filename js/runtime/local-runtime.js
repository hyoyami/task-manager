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

  function profileByUsername(uname) {
    var u = String(uname || '').trim().toLowerCase();
    return Object.keys(store).filter(function (k) { return k.indexOf('profiles/') === 0; })
      .map(function (k) { return store[k]; })
      .find(function (p) { return String(p.username || '').toLowerCase() === u; });
  }
  function emailForUsername(uname) { var p = profileByUsername(uname); return p ? p.email : null; }

  /** Equivalentes locais das funções do banco do Supabase (supabase/schema.sql). */
  var functions = {
    username_available: async function (args) { return !profileByUsername(args.uname); },
    // Mesmo efeito das funções delete_my_account / delete_company do Supabase.
    delete_my_account: async function () {
      var me = currentAid;
      if (!me) throw new Error('Faça login.');
      var owns = Object.keys(store).some(function (k) { return k.indexOf('companies/') === 0 && store[k].admin === me; });
      if (owns) throw new Error('Você é administrador de uma empresa: exclua a empresa antes de excluir a conta.');
      var now = Date.now();
      Object.keys(store).forEach(function (k) {
        var v = store[k];
        if (k.indexOf('tasks/') === 0 && ['concluida', 'cancelada'].indexOf(v.status) < 0) {
          var hist = (v.hist || []).slice();
          if (v.req === me) {
            hist.push({ t: now, x: 'Cancelada: a conta de quem pediu foi excluída' });
            store[k] = Object.assign({}, v, { status: 'cancelada', hist: hist });
          } else if (v.emp === me) {
            hist.push({ t: now, x: 'Voltou a ficar aberta para a equipe: a conta do funcionário foi excluída' });
            store[k] = Object.assign({}, v, { emp: null, pool: true, status: v.status === 'programada' ? 'programada' : 'aguardando', start: null, cat: v.devArea || null, hist: hist });
          }
        }
        if ((k.indexOf('notifs/') === 0 && v.to === me) || (k.indexOf('invites/') === 0 && v.by === me)) delete store[k];
      });
      var profile = store['profiles/' + me] || {};
      delete store['profiles/' + me];
      delete store['cred/' + (profile.ck || me)];
      save();
      emit();
    },
    delete_company: async function () {
      var me = currentAid;
      var key = Object.keys(store).find(function (k) { return k.indexOf('companies/') === 0 && store[k].admin === me; });
      if (!key) throw new Error('Só o administrador pode excluir a empresa.');
      var cid = key.slice('companies/'.length);
      Object.keys(store).forEach(function (k) {
        var v = store[k];
        if (/^(tasks|devices|tutorials|notifs|invites)\//.test(k) && v.company === cid) delete store[k];
        else if (k.indexOf('profiles/') === 0 && v.company === cid) store[k] = Object.assign({}, v, { company: null, status: null, role: null });
      });
      delete store[key];
      save();
      emit();
    },
    // Mesmas verificações da função claim_task do Supabase.
    claim_task: async function (args) {
      var t = store['tasks/' + args.task_id];
      var me = store['profiles/' + currentAid];
      if (!t || !me || me.status !== 'active' || t.company !== me.company) throw new Error('Tarefa não encontrada.');
      if (!t.pool) throw new Error('Esta tarefa não está aberta para a equipe.');
      if (t.emp) throw new Error('Outro funcionário já pegou esta tarefa.');
      if (t.status !== 'aguardando') throw new Error('Esta tarefa não está aberta para a equipe.');
      if (me.role === 'func' && t.cat) {
        var company = store['companies/' + t.company] || {};
        var cargo = (company.cargos || {})[(me.ws || {}).cargo];
        if (cargo && (cargo.cats || []).indexOf(t.cat) < 0) throw new Error('Esta tarefa não é da sua função.');
      } else if (me.role !== 'admin' && me.role !== 'func') {
        throw new Error('Só funcionários e o administrador assumem tarefas.');
      }
      var hist = (t.hist || []).concat([{ t: Date.now(), x: 'Assumida por ' + (me.name || '—') }]);
      await docRef('tasks/' + args.task_id).update({ emp: currentAid, hist: hist });
    },
    join_with_invite: async function (args) {
      var invite = store['invites/' + args.code];
      if (!invite || !currentAid || !store['profiles/' + currentAid]) throw new Error('Convite inválido.');
      var profile = store['profiles/' + currentAid];
      var patch = { company: invite.company, role: invite.role, status: 'active' };
      if (invite.role === 'func') patch.ws = Object.assign({}, profile.ws || {}, { setup: false });
      await docRef('profiles/' + currentAid).update(patch);
      return invite.company;
    },
  };

  var db = {
    collection: function (name) { return collectionRef(name); },
    doc: function (path) { return docRef(path); },
    call: async function (fn, args) {
      if (!functions[fn]) throw new Error('Função desconhecida: ' + fn);
      return functions[fn](args || {});
    },
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
    /** `login` é o e-mail ou o nome de usuário. */
    signIn: async function (login, password, keep) {
      var email = login.indexOf('@') < 0 ? emailForUsername(login) : login;
      var id = email ? await credIdOf(email) : null;
      var cred = id && credOf(id);
      if (!(await matches(cred, password))) throw new Error('E-mail/usuário ou senha incorretos.');
      var aid = cred.aid || id;
      if (store['profiles/' + aid]) await docRef('profiles/' + aid).update({ ck: id });
      writeAid(aid, keep);
      return (currentAid = aid);
    },
    resendConfirmation: async function () {}, // modo local: sem e-mail de confirmação
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
    verifyPassword: async function (password) {
      if (!(await matches(credOf(myCredId()), password))) throw new Error('Senha atual incorreta.');
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
