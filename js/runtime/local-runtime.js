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

   Para usar um backend real, substitua este arquivo por chamadas à API.
   ========================================================================== */
(function () {
  'use strict';

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

  window.claude = {
    use: async function (name) {
      if (name === 'db') return db;
      if (name === 'user') return user;
      return null;
    },
  };
})();
