/* ==========================================================================
   Aparelhos: aba Aparelhos (solicitante, somente leitura), Workstation
   (funcionário: configuração inicial e lista) e "Workstation configuração".
   ========================================================================== */
'use strict';

const byText = (key) => (a, b) => String(key(a)).localeCompare(String(key(b)));

// ---------- Organização (grupos e ordem) ----------
function groupHtml(owner, group, ids, editable) {
  const icon = when(group.cat, categoryIcon(categoryByName(owner, group.cat)));
  return '<section class="dev-group" data-gid="' + esc(group.id) + '">'
    + '<div class="row between nowrap dev-group-head">'
    + '<h3>' + when(editable, '<span class="group-handle" title="Arrastar grupo" aria-hidden="true">⠿</span>')
    + icon + esc(group.name) + ' <span class="muted">(' + ids.length + ')</span></h3>'
    + when(editable, '<span class="row nowrap gap-sm">'
      + '<button class="small" data-grename="' + esc(group.id) + '" aria-label="Renomear grupo" title="Renomear grupo">✎</button>'
      + '<button class="small" data-gungroup="' + esc(group.id) + '" aria-label="Desfazer grupo" title="Desfazer grupo">Desagrupar</button></span>')
    + '</div><div class="device-grid">' + each(ids, (id) => deviceCard(state.devices[id], editable)) + '</div></section>';
}

/**
 * Aparelhos de `owner` na organização definida por ele.
 * Aparelhos soltos consecutivos ficam numa mesma grade; cada grupo é uma seção.
 */
function deviceBoard(owner, { editable = false, filter = null } = {}) {
  const pass = (id) => !filter || filter(state.devices[id]);
  let html = '';
  let loose = [];
  const flush = () => {
    if (loose.length) html += '<div class="device-grid loose">' + each(loose, (id) => deviceCard(state.devices[id], editable)) + '</div>';
    loose = [];
  };
  for (const item of deviceLayout(owner)) {
    if (item.type === 'dev') {
      if (pass(item.id)) loose.push(item.id);
      continue;
    }
    flush();
    const ids = item.items.filter(pass);
    if (ids.length) html += groupHtml(owner, item, ids, editable);
  }
  flush();
  return html;
}

// ---------- Aba Aparelhos (solicitante) ----------
/** Seção de uma categoria: só pode ser arrastada (reordenar), sem mexer nos aparelhos. */
function requesterCategoryGroup(cat, devices) {
  return '<section class="dev-group" data-gid="' + esc(cat) + '">'
    + '<div class="row between nowrap dev-group-head"><h3><span class="group-handle" title="Arrastar categoria" aria-hidden="true">⠿</span>'
    + categoryIcon(categoryByName(devices[0].owner, cat)) + esc(cat) + ' <span class="muted">(' + devices.length + ')</span></h3></div>'
    + '<div class="device-grid">' + each(devices, (d) => deviceCard(d, false)) + '</div></section>';
}

function viewDevices() {
  const all = Object.values(state.devices);
  const f = ui.deviceFilter;
  const filter = (d) => (!f.cat || d.area === f.cat) && (!f.status || d.status === f.status);
  const option = (value, current) => '<option' + when(current === value, ' selected') + '>' + esc(value) + '</option>';
  const cats = requesterCategoryOrder(new Set(all.map((d) => d.area)));
  const groups = each(cats, (cat) => {
    const devices = all.filter((d) => d.area === cat && filter(d)).sort(byText((d) => d.name));
    return devices.length ? requesterCategoryGroup(cat, devices) : '';
  });

  return '<h1>Aparelhos</h1><div class="row toolbar lg">'
    + '<select id="af_c" class="inline"><option value="">Todas as categorias</option>' + each([...cats].sort(), (c) => option(c, f.cat)) + '</select>'
    + '<select id="af_s" class="inline"><option value="">Todos os status</option>' + each(DEVICE_STATUSES, (s) => option(s, f.status)) + '</select>'
    + '</div>'
    + (groups
      ? '<p class="muted">Arraste a categoria pelo ⠿ (ou pelo título, com o mouse) para mudar a ordem.</p><div id="cat_board" class="dev-board">' + groups + '</div>'
      : emptyCard('Nenhum aparelho encontrado.', true));
}

// ---------- Workstation (funcionário) ----------
function deviceForm() {
  return '<div class="card"><b>Novo aparelho</b>'
    + '<label>Categoria</label><select id="dv_a">' + each(myCategories(), (c) => '<option>' + esc(c.name) + '</option>') + '</select>'
    + '<label>Nome</label><input type="text" id="dv_n" placeholder="Ex.: PC Recepção">'
    + '<label>IP</label><input type="text" id="dv_i" inputmode="decimal" placeholder="Ex.: 192.168.0.25">'
    + '<p><button class="primary" id="dv_add">Cadastrar aparelho</button></p></div>';
}

/** Etapa 1 da configuração: escolher o cargo. */
function setupStep1() {
  return '<p class="muted">Selecione o seu cargo. Os aparelhos que você cuida serão sugeridos automaticamente.</p>'
    + '<div class="card"><label>Cargo</label><select id="w_c"><option value="">Selecione…</option>'
    + each(Object.entries(CARGOS), ([k, v]) => '<option value="' + k + '"' + when(state.me.ws?.cargo === k, ' selected') + '>' + esc(v.n) + '</option>')
    + '</select><p><button class="primary" id="w_save">Continuar</button></p></div>';
}

/** Etapa 2 da configuração: cadastrar os aparelhos. */
function setupStep2() {
  const devices = Object.values(state.myDevices).sort((a, b) => a.created - b.created);
  return '<p class="muted">Etapa 2 — cadastre os aparelhos de que você cuida. Informe nome e IP de cada um.</p>'
    + '<p><button class="small" data-wst="back1">← Voltar ao cargo</button></p>'
    + when(devices.length, '<h2>Aparelhos cadastrados (' + devices.length + ')</h2>'
      + each(devices, (d) => '<div class="card"><b>' + esc(d.name) + '</b> ' + tag(esc(d.area)) + '<div class="muted">IP ' + esc(d.ip || '—') + '</div></div>'))
    + deviceForm()
    + '<div class="card">'
    + when(!devices.length, '<label class="check check-lg first"><input type="checkbox" id="w_skip">Não adicionar aparelhos agora</label>')
    + '<p><button class="primary" id="w_done">Concluir cadastro</button></p></div>';
}

/** Aparelhos do funcionário, na organização dele (arrastável). */
function myDeviceList() {
  const add = '<p><button class="small primary" data-wst="new">＋ Adicionar aparelho</button></p>';
  if (!Object.keys(state.myDevices).length) return add + emptyCard('Nenhum aparelho cadastrado ainda.');
  return add
    + '<p class="muted">Arraste pelo ⠿ (ou pelo cartão, com o mouse) para organizar. Solte <b>sobre</b> outro aparelho para criar um grupo; '
    + 'solte <b>fora dos grupos</b> para tirá-lo do grupo.</p>'
    + '<div id="dv_board" class="dev-board">' + deviceBoard(state.uid, { editable: true }) + '</div>';
}

function viewWorkstation() {
  const title = '<h1>Workstation</h1>';
  const ws = state.me.ws || {};
  if (!ws.setup) return title + (ws.s1 && ui.wsStep !== 'back1' ? setupStep2() : setupStep1());
  if (ui.wsStep === 'new') {
    return '<h1>Novo aparelho</h1><p><button class="small" data-wst="dev">← Voltar aos aparelhos</button></p>' + deviceForm();
  }
  return title + myDeviceList();
}

// ---------- Workstation configuração ----------
function viewWorkstationConfig() {
  const devices = Object.values(state.myDevices).sort((a, b) => byText((d) => d.area)(a, b) || a.created - b.created);
  const categoryRow = (c) => '<div class="row between nowrap list-row compact">'
    + '<button class="link-row" data-cat="' + esc(c.name) + '">' + categoryIcon(c) + esc(c.name)
    + ' <span class="muted">(' + problemsOf(state.me.ws, c.name).length + ' problemas) ›</span></button>'
    + removeButton('data-cdel="' + esc(c.name) + '"', 'Excluir categoria') + '</div>';
  const deviceRow = (d) => '<div class="card"><div class="row between"><div><b>' + esc(d.name) + '</b>'
    + '<div class="muted">' + esc(d.area) + when(d.ip, ' · IP ' + esc(d.ip)) + '</div></div>'
    + '<button class="small danger" data-ddel="' + d.id + '">' + (ui.deviceDeleteArmed === d.id ? 'Confirmar exclusão' : 'Excluir') + '</button></div></div>';

  return '<h1>Workstation configuração</h1>'
    + '<div class="card"><b>Nova categoria de aparelho</b>'
    + '<label>Nome da categoria</label><input type="text" id="wc_n" placeholder="Ex.: Roteador">'
    + '<label>Ícone (imagem PNG)</label><input type="file" id="wc_f" accept="image/png">'
    + '<p><button class="primary" id="wc_add">Adicionar categoria</button></p></div>'
    + '<h2>Categorias</h2><div class="card">' + (each(myCategories(), categoryRow) || '<span class="muted">Nenhuma.</span>') + '</div>'
    + '<h2>Aparelhos</h2>' + (each(devices, deviceRow) || emptyCard('Nenhum aparelho cadastrado.'));
}
