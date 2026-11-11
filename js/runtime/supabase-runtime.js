/* ==========================================================================
   Back-end Supabase (PostgreSQL + Auth + Realtime).

   Expõe a mesma API do local-runtime.js, para o app não precisar saber
   onde os dados estão:
     claude.use('db')   → collection/doc/where/onSnapshot/set/update/delete/get
     claude.use('auth') → login (ver "Login" abaixo)
     claude.use('user') → identifica que há back-end disponível

   Cada coleção é uma tabela com { id, data jsonb } (supabase/schema.sql).
   update() usa a função doc_merge do banco (mescla atômica no jsonb).
   Escritas feitas aqui já atualizam as assinaturas abertas (eco local),
   sem esperar o evento de tempo real — igual ao comportamento do modo local.
   ========================================================================== */
(function () {
  'use strict';
  var cfg = window.TM_CONFIG || {};
  if (cfg.backend !== 'supabase') return;
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Biblioteca do Supabase não carregou (sem internet?).');
    window.claude = { use: async function () { return null; } };
    return;
  }

  var KEEP_KEY = 'tm_keep';         // "manter conectado": '1' localStorage, '0' sessionStorage
  var SESSIONS_KEY = 'tm_sessions'; // sessões das contas salvas (para "Trocar de conta")

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function clone(o) { return o === undefined || o === null ? o : JSON.parse(JSON.stringify(o)); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // A sessão vai para o localStorage ("manter conectado") ou para o sessionStorage.
  var keep = function () { return safe(function () { return localStorage.getItem(KEEP_KEY) !== '0'; }, true); };
  var sessionStorageAdapter = {
    getItem: function (k) { return safe(function () { return localStorage.getItem(k) || sessionStorage.getItem(k); }, null); },
    setItem: function (k, v) {
      safe(function () {
        (keep() ? localStorage : sessionStorage).setItem(k, v);
        (keep() ? sessionStorage : localStorage).removeItem(k);
      });
    },
    removeItem: function (k) { safe(function () { localStorage.removeItem(k); sessionStorage.removeItem(k); }); },
  };

  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { storage: sessionStorageAdapter, persistSession: true, autoRefreshToken: true },
  });

  /** Garante que o tempo real use o token do usuário logado. */
  async function authReady() {
    var r = await sb.auth.getSession();
    if (r.data.session) await sb.realtime.setAuth(r.data.session.access_token);
  }

  // ---------- Banco ----------
  /** Assinaturas abertas por tabela, para o eco local das escritas. */
  var subscriptions = {};

  function fail(error) {
    var e = new Error(error && error.message ? error.message : String(error));
    e.cause = error;
    return e;
  }

  function split(path) {
    var i = path.indexOf('/');
    return { table: path.slice(0, i), id: path.slice(i + 1) };
  }

  function echo(table, fn) {
    (subscriptions[table] || new Set()).forEach(function (s) { fn(s); if (s.ready) s.emit(); });
  }

  function docRef(path) {
    var p = split(path);
    return {
      id: p.id,
      path: path,
      // insert simples (um upsert exigiria permissão de leitura da linha — ex.: notificação
      // para outra pessoa seria bloqueada pelo RLS); se já existir, substitui o documento.
      set: async function (data) {
        var r = await sb.from(p.table).insert({ id: p.id, data: clone(data) });
        if (r.error && r.error.code === '23505') r = await sb.from(p.table).update({ data: clone(data) }).eq('id', p.id);
        if (r.error) throw fail(r.error);
        echo(p.table, function (s) { if (s.match(data)) s.cache.set(p.id, clone(data)); else s.cache.delete(p.id); });
      },
      update: async function (patch) {
        var r = await sb.rpc('doc_merge', { tbl: p.table, doc_id: p.id, patch: clone(patch) });
        if (r.error) throw fail(r.error);
        echo(p.table, function (s) {
          var cur = s.cache.get(p.id);
          if (!cur) return;
          var next = Object.assign({}, cur, clone(patch));
          if (s.match(next)) s.cache.set(p.id, next); else s.cache.delete(p.id);
        });
      },
      delete: async function () {
        var r = await sb.from(p.table).delete().eq('id', p.id);
        if (r.error) throw fail(r.error);
        echo(p.table, function (s) { s.cache.delete(p.id); });
      },
      get: async function () {
        var r = await sb.from(p.table).select('data').eq('id', p.id).maybeSingle();
        if (r.error) throw fail(r.error);
        return { exists: !!r.data, id: p.id, data: function () { return r.data ? clone(r.data.data) : undefined; } };
      },
    };
  }

  function collectionRef(name, filter) {
    return {
      doc: function (id) { return docRef(name + '/' + (id || newId())); },
      // Só o operador '==' é suportado (é o que o app usa).
      where: function (field, op, value) { return collectionRef(name, { field: field, value: value }); },
      onSnapshot: function (callback, onError) {
        var sub = {
          cache: new Map(),
          ready: false,
          match: function (d) { return !filter || (d && d[filter.field] === filter.value); },
          emit: function () {
            var docs = [];
            sub.cache.forEach(function (data, id) { docs.push({ id: id, data: function () { return clone(data); } }); });
            callback({ docs: docs });
          },
        };
        (subscriptions[name] = subscriptions[name] || new Set()).add(sub);

        var closed = false;

        // Carrega o estado atual (de novo a cada (re)conexão do canal, para não perder
        // mudanças feitas enquanto o canal ainda conectava).
        function load() {
          var query = sb.from(name).select('id,data');
          if (filter) query = query.eq('data->>' + filter.field, filter.value);
          return query.then(function (r) {
            if (closed) return;
            if (r.error) { if (onError) onError(fail(r.error)); return; }
            sub.cache = new Map();
            r.data.forEach(function (row) { sub.cache.set(row.id, row.data); });
            sub.ready = true;
            sub.emit();
          });
        }

        var channel = null;
        // O tempo real precisa do token do usuário antes de assinar (senão o RLS não entrega nada).
        authReady().then(function () {
          if (closed) return;
          channel = sb.channel('tm-' + name + '-' + newId())
            .on('postgres_changes', { event: '*', schema: 'public', table: name }, function (ev) {
              if (ev.eventType === 'DELETE') sub.cache.delete(ev.old.id);
              else if (sub.match(ev.new.data)) sub.cache.set(ev.new.id, ev.new.data);
              else sub.cache.delete(ev.new.id);
              if (sub.ready) sub.emit();
            })
            .subscribe(function (status) { if (status === 'SUBSCRIBED') load(); });
        });
        load();

        return function () {
          closed = true;
          subscriptions[name].delete(sub);
          if (channel) sb.removeChannel(channel);
        };
      },
    };
  }

  var db = {
    collection: function (name) { return collectionRef(name); },
    doc: function (path) { return docRef(path); },
  };

  // ---------- Login (Supabase Auth) ----------
  function savedSessions() { return safe(function () { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}'); }, {}); }
  function writeSessions(map) { safe(function () { localStorage.setItem(SESSIONS_KEY, JSON.stringify(map)); }); }
  function rememberSession(s) {
    var map = savedSessions();
    map[s.user.id] = { access_token: s.access_token, refresh_token: s.refresh_token };
    writeSessions(map);
  }
  function forgetSession(id) { var map = savedSessions(); delete map[id]; writeSessions(map); }

  // Os tokens são renovados periodicamente: guarda sempre o mais recente de cada conta.
  sb.auth.onAuthStateChange(function (event, session) { if (session) rememberSession(session); });

  /** Mensagens do Supabase Auth → português. */
  function authMessage(error) {
    var m = (error && error.message) || '';
    if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/already (been )?registered|already exists/i.test(m)) return 'Este e-mail já está cadastrado.';
    if (/email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link enviado antes de entrar.';
    if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos.';
    if (/password should be|at least/i.test(m)) return 'A senha precisa ter ao menos 6 caracteres.';
    if (/invalid.*email|email.*invalid/i.test(m)) return 'Informe um e-mail válido.';
    if (/failed to fetch|network/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
    return m || 'Não foi possível concluir. Tente novamente.';
  }

  function setKeep(value) { safe(function () { localStorage.setItem(KEEP_KEY, value ? '1' : '0'); }); }

  async function currentUser() {
    var r = await sb.auth.getSession();
    return r.data.session ? r.data.session.user : null;
  }

  /** Confirma a senha atual entrando de novo com ela. */
  async function verifyPassword(password) {
    var user = await currentUser();
    if (!user) throw new Error('Sessão expirada. Entre novamente.');
    var r = await sb.auth.signInWithPassword({ email: user.email, password: password });
    if (r.error) throw new Error('Senha atual incorreta.');
  }

  var auth = {
    kind: 'supabase',
    restore: async function () { var u = await currentUser(); return u ? u.id : null; },
    signUp: async function (email, password, keepConnected) {
      setKeep(keepConnected);
      var r = await sb.auth.signUp({ email: email, password: password });
      if (r.error) throw new Error(authMessage(r.error));
      // Com confirmação de e-mail ligada, um e-mail já usado volta sem identidades.
      if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) {
        throw new Error('Este e-mail já está cadastrado.');
      }
      if (!r.data.session) {
        throw new Error('Cadastro criado! Confirme o e-mail pelo link enviado e depois entre.');
      }
      return r.data.user.id;
    },
    signIn: async function (email, password, keepConnected) {
      setKeep(keepConnected);
      var r = await sb.auth.signInWithPassword({ email: email, password: password });
      if (r.error) throw new Error(authMessage(r.error));
      return r.data.user.id;
    },
    signOut: async function () {
      var u = await currentUser();
      if (u) forgetSession(u.id);
      await sb.auth.signOut({ scope: 'local' });
    },
    /** "Entrar com outra conta": mantém a sessão atual guardada para poder voltar a ela. */
    detach: async function () {},
    /** Volta para uma conta salva neste aparelho, sem pedir senha. */
    resume: async function (id) {
      var s = savedSessions()[id];
      if (!s) return false;
      var r = await sb.auth.setSession(s);
      if (r.error || !r.data.session) { forgetSession(id); return false; }
      return true;
    },
    /** Devolve { pending: true } quando o Supabase exige confirmar o novo e-mail. */
    changeEmail: async function (email, password) {
      await verifyPassword(password);
      var r = await sb.auth.updateUser({ email: email });
      if (r.error) throw new Error(/already|registered|exists/i.test(r.error.message) ? 'Este e-mail já está em uso.' : authMessage(r.error));
      return { pending: !r.data.user || r.data.user.email !== email };
    },
    changePassword: async function (current, next) {
      await verifyPassword(current);
      var r = await sb.auth.updateUser({ password: next });
      if (r.error) throw new Error(authMessage(r.error));
    },
  };

  var user = { id: async function () { return 'supabase'; } };

  window.claude = {
    use: async function (name) {
      if (name === 'db') return db;
      if (name === 'auth') return auth;
      if (name === 'user') return user;
      return null;
    },
  };
})();
