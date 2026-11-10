/* Banco de dados local do TASK MANAGER.
   Substitui o banco do claude.ai e guarda tudo no localStorage deste navegador. */
(function () {
  var KEY = 'tm_db_v1', store = {}, subs = new Set();
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  var clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { alert('Armazenamento do navegador cheio.'); } };
  var notify = function () { subs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); };
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { try { store = JSON.parse(e.newValue || '{}'); } catch (_) {} notify(); }
  });
  var ref = function (path) {
    return {
      id: path.split('/').pop(), path: path,
      set: async function (d) { store[path] = clone(d); save(); notify(); },
      update: async function (d) {
        if (!store[path]) throw new Error('Documento n\u00e3o existe: ' + path);
        store[path] = Object.assign({}, store[path], clone(d)); save(); notify();
      },
      delete: async function () { delete store[path]; save(); notify(); },
      get: async function () { return { exists: !!store[path], id: path.split('/').pop(), data: function () { return clone(store[path]); } }; }
    };
  };
  var col = function (name, flt) {
    return {
      doc: function (id) { return ref(name + '/' + (id || uid())); },
      where: function (f, op, v) { return col(name, function (d) { return d[f] === v; }); },
      onSnapshot: function (cb) {
        var run = function () {
          cb({ docs: Object.keys(store).filter(function (k) { return k.indexOf(name + '/') === 0 && (!flt || flt(store[k])); })
            .map(function (k) { return { id: k.slice(name.length + 1), data: function () { return clone(store[k]); } }; }) });
        };
        subs.add(run); setTimeout(run, 0);
        return function () { subs.delete(run); };
      }
    };
  };
  var db = { collection: function (n) { return col(n); }, doc: function (p) { return ref(p); } };
  window.claude = { use: async function (n) { return n === 'db' ? db : n === 'user' ? { id: async function () { return 'local'; } } : null; } };
})();
