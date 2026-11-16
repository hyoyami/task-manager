/* ==========================================================================
   Aba Empresa (administrador): pedidos de entrada, membros e papéis,
   links de convite, funções e categorias/problemas de manutenção.
   ========================================================================== */
'use strict';

const roleOptions = (current) => each(ASSIGNABLE_ROLES, (r) =>
  '<option value="' + r + '"' + when(r === current, ' selected') + '>' + ROLE_LABEL[r] + '</option>');

const cargoOptions = (current) => each(Object.entries(companyCargos()), ([k, v]) =>
  '<option value="' + esc(k) + '"' + when(k === current, ' selected') + '>' + esc(v.n) + '</option>');

function joinRequestRow(p) {
  return '<div class="card member-row" data-member="' + esc(p.id) + '">'
    + '<div class="row nowrap">' + avatar(p.id, p.name, 34)
    + '<div class="grow"><b>' + esc(p.name) + '</b><div class="muted">' + esc(p.email || '') + '</div>'
    + when(p.requestedAt, '<div class="muted">Pedido ' + timeAgo(p.requestedAt) + '</div>') + '</div></div>'
    + '<div class="grid-2">'
    + '<div><label>Papel</label><select class="jr-role" data-id="' + esc(p.id) + '">' + roleOptions(p.role === 'func' ? 'func' : 'sol') + '</select></div>'
    + '<div><label>Função (funcionário)</label><select class="jr-cargo" data-id="' + esc(p.id) + '">' + cargoOptions(p.ws?.cargo || 'ti') + '</select></div>'
    + '</div>'
    + '<div class="row actions"><button class="small primary" data-accept="' + esc(p.id) + '">Aceitar</button>'
    + '<button class="small danger" data-reject="' + esc(p.id) + '">Recusar</button></div></div>';
}

function memberRow(p) {
  const self = p.id === state.uid;
  return '<div class="card member-row">'
    + '<div class="row nowrap">' + avatar(p.id, p.name, 34)
    + '<div class="grow"><b>' + esc(p.name) + '</b>' + when(self, ' <span class="muted">(você)</span>')
    + '<div class="muted">' + esc(p.email || '') + '</div></div>'
    + when(p.role === 'admin', tag('Administrador')) + '</div>'
    + when(!self && p.role !== 'admin', '<div class="grid-2">'
      + '<div><label>Papel</label><select class="m-role" data-id="' + esc(p.id) + '">' + roleOptions(p.role) + '</select></div>'
      + '<div><label>Função</label><select class="m-cargo" data-id="' + esc(p.id) + '"' + when(p.role !== 'func', ' disabled') + '>'
      + '<option value="">—</option>' + cargoOptions(p.ws?.cargo) + '</select></div></div>'
      + '<div class="row actions"><button class="small danger" data-mremove="' + esc(p.id) + '">Remover da empresa</button></div>')
    + '</div>';
}

function inviteRow([code, inv]) {
  return '<div class="card"><div class="row between"><b>Convite: ' + esc(ROLE_LABEL[inv.role] || inv.role) + '</b>'
    + '<span class="muted">criado ' + timeAgo(inv.created) + '</span></div>'
    + '<input type="text" class="invite-link" readonly value="' + esc(inviteLink(code)) + '" aria-label="Link de convite">'
    + '<div class="row actions"><button class="small primary" data-invcopy="' + esc(code) + '">Copiar link</button>'
    + '<button class="small danger" data-invdel="' + esc(code) + '">Excluir</button></div></div>';
}

function cargoCard([key, cargo]) {
  const cats = companyCategories();
  return '<div class="card"><div class="row between"><b>' + esc(cargo.n) + '</b>'
    + when(Object.keys(companyCargos()).length > 1, '<button class="small danger" data-cgdel="' + esc(key) + '">Excluir</button>') + '</div>'
    + '<p class="muted">Categorias de aparelho que esta função vê e atende:</p><div class="row gap-lg">'
    + each(cats, (c) => '<label class="check day"><input type="checkbox" class="cg-cat" data-cargo="' + esc(key) + '" data-cgcat="' + esc(c.name) + '"'
      + when((cargo.cats || []).includes(c.name), ' checked') + '>' + categoryIcon(c) + esc(c.name) + '</label>')
    + '</div></div>';
}

/** Quem pode excluir a categoria: o admin sempre; o funcionário só se ela não tiver aparelhos. */
const canDeleteCategory = (name) => isAdmin() || !Object.values(state.devices).some((d) => d.area === name);

/** Nova categoria + lista (com problemas). Admin: todas; funcionário: as da sua função. */
function categoryManager(list = companyCategories()) {
  const categoryRow = (c) => '<div class="row between nowrap list-row compact">'
    + '<button class="link-row" data-cat="' + esc(c.name) + '">' + categoryIcon(c) + esc(c.name)
    + ' <span class="muted">(' + problemsOf(c.name).length + ' problemas) ›</span></button>'
    + when(canDeleteCategory(c.name), removeButton('data-cdel="' + esc(c.name) + '"', 'Excluir categoria')) + '</div>';
  return '<div class="card"><b>Nova categoria de aparelho</b>'
    + '<label>Nome da categoria</label><input type="text" id="wc_n" placeholder="Ex.: Roteador">'
    + '<label>Ícone (imagem PNG)</label><input type="file" id="wc_f" accept="image/png">'
    + '<p><button class="primary" id="wc_add">Adicionar categoria</button></p></div>'
    + '<div class="card">' + (each(list, categoryRow) || '<span class="muted">Nenhuma.</span>') + '</div>';
}

function viewCompany() {
  const c = state.company;
  const requests = state.joinRequests;
  const members = Object.values(state.profiles)
    .sort((a, b) => (a.role === 'admin' ? -1 : b.role === 'admin' ? 1 : String(a.name).localeCompare(String(b.name))));
  const invites = Object.entries(state.invites).sort((a, b) => b[1].created - a[1].created);

  return '<h1>Empresa</h1>'
    + '<div class="card"><label for="adm_name">Nome da empresa</label>'
    + '<div class="row nowrap"><input type="text" id="adm_name" class="grow" maxlength="60" value="' + esc(c.name) + '">'
    + '<button class="primary" id="adm_save">Salvar</button></div></div>'

    + '<h2>Pedidos de entrada' + when(requests.length, ' <span class="badge">' + requests.length + '</span>') + '</h2>'
    + (each(requests, joinRequestRow) || emptyCard('Nenhum pedido aguardando.'))

    + '<h2>Convidar por link</h2><div class="card">'
    + '<p class="muted">Quem se cadastrar pelo link entra direto na empresa, com o papel escolhido.</p>'
    + '<div class="row nowrap"><select id="adm_ir" class="grow">' + roleOptions('func') + '</select>'
    + '<button class="primary" id="adm_inv">Gerar link</button></div></div>'
    + each(invites, inviteRow)

    + '<h2>Membros (' + members.length + ')</h2>' + each(members, memberRow)

    + '<h2>Funções</h2>' + each(Object.entries(companyCargos()), cargoCard)
    + '<div class="card"><label for="adm_cg_n">Nova função</label><div class="row nowrap">'
    + '<input type="text" id="adm_cg_n" class="grow" maxlength="40" placeholder="Ex.: Desenvolvedor">'
    + '<button class="primary" id="adm_cg_add">Adicionar</button></div></div>'

    + '<h2>Categorias e problemas</h2>' + categoryManager()
    + '<div class="card danger-zone mt-12"><b>Excluir empresa</b>'
    + '<p class="muted">Apaga a empresa e todos os dados dela: tarefas, aparelhos e logs, tutoriais e convites. '
    + 'Os membros (e você) continuam com a conta, mas ficam sem empresa. Não dá para desfazer.</p>'
    + '<p class="mb-0"><button class="small danger" id="xc_open">Excluir empresa</button></p></div>';
}
