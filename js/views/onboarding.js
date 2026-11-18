/* ==========================================================================
   Entrada na empresa: depois de criar a conta, a pessoa cria uma empresa
   (vira administradora) ou pede para entrar numa existente. Enquanto o pedido
   não é aceito, fica nesta tela. Quem chega por link de convite entra direto.
   ========================================================================== */
'use strict';

function viewOnboarding() {
  const me = state.me;
  const head = '<h1 class="auth-hello">Olá, ' + esc(me.name) + '!</h1>';
  const wrap = (html) => '<section class="auth with-header">' + html + '</section>';

  if (me.company && me.status === 'pending') {
    const company = state.companies[me.company];
    return wrap(head + '<div class="auth-card">'
      + '<h2 class="auth-title">Pedido enviado</h2>'
      + '<p class="auth-lead">Você pediu para entrar em <b>' + esc(company?.name || 'uma empresa') + '</b> como <b>'
      + esc(ROLE_LABEL[me.role] || '—') + '</b>.</p>'
      + '<p class="muted">Assim que o administrador aceitar, o sistema abre automaticamente.</p>'
      + '<button class="btn-lg block danger" id="ob_cancel">Cancelar pedido</button></div>');
  }

  const companies = Object.values(state.companies).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const joinCard = '<div class="auth-card">'
    + '<h2 class="auth-title">Entrar em uma empresa</h2>'
    + '<label for="ob_company">Empresa</label><select id="ob_company"><option value="">Selecione…</option>'
    + each(companies, (c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>') + '</select>'
    + '<label for="ob_role">Eu sou</label><select id="ob_role">'
    + '<option value="sol">Solicitante — peço tarefas</option><option value="func">Funcionário — executo tarefas</option></select>'
    + '<p class="muted auth-hint">O administrador da empresa recebe o seu pedido e confirma o seu papel.</p>'
    + '<button class="primary btn-lg block" id="ob_join">Pedir para entrar</button>'
    + '<p class="auth-switch">Tem um link de convite? Abra o link e você entra direto.</p></div>';
  const createCard = '<div class="auth-card">'
    + '<h2 class="auth-title">Cadastrar minha empresa</h2>'
    + '<p class="muted auth-hint">Você será o <b>administrador</b>: cadastra os aparelhos, aceita os membros e define os papéis.</p>'
    + '<label for="ob_cn">Nome da empresa</label><input type="text" id="ob_cn" maxlength="60" placeholder="Ex.: Acme Ltda.">'
    + addressFields('ob')
    + '<p class="muted auth-hint">Pelo endereço, a agenda já marca os feriados nacionais, estaduais e municipais da cidade.</p>'
    + '<button class="primary btn-lg block" id="ob_create">Criar empresa</button></div>';

  // Sem empresas na lista, só faz sentido cadastrar a sua (ou usar um convite).
  return wrap(head + '<p class="auth-lead">Para começar, entre na sua empresa ou cadastre uma nova.</p>'
    + (companies.length ? joinCard + createCard
      : createCard + '<p class="auth-switch">Tem um link de convite? Abra o link e você entra direto.</p>'));
}

/** Etapa logo após criar a empresa: o administrador cadastra os aparelhos dela. */
function viewCompanySetup() {
  const devices = Object.values(state.devices).sort((a, b) => a.created - b.created);
  const row = (d) => '<div class="row between nowrap list-row">'
    + '<span>' + categoryIcon(categoryByName(d.area)) + '<b>' + esc(d.name) + '</b> '
    + '<span class="muted">' + esc(d.area) + ' · IP ' + esc(d.ip || '—') + '</span></span>'
    + removeButton('data-csdel="' + d.id + '"', 'Remover aparelho') + '</div>';
  return '<section class="auth with-header setup">'
    + '<h1 class="auth-hello">' + esc(state.company.name) + '</h1>'
    + '<p class="auth-lead">Último passo: cadastre os aparelhos da empresa. Eles aparecem para toda a equipe '
    + '(cada funcionário vê os das categorias da sua função).</p>'
    + '<div class="auth-card">'
    + '<h2 class="auth-title">Aparelhos da empresa</h2>'
    + (devices.length ? '<div class="setup-list">' + each(devices, row) + '</div>'
      : '<p class="muted">Nenhum aparelho cadastrado ainda.</p>')
    + '<label for="dv_a">Categoria</label><select id="dv_a">' + each(companyCategories(), (c) => '<option>' + esc(c.name) + '</option>') + '</select>'
    + '<div class="grid-2"><div><label for="dv_n">Nome</label><input type="text" id="dv_n" placeholder="Ex.: PC Recepção"></div>'
    + '<div><label for="dv_i">IP</label><input type="text" id="dv_i" inputmode="decimal" placeholder="Ex.: 192.168.0.25"></div></div>'
    + '<button class="btn-lg block" id="dv_add">＋ Adicionar aparelho</button>'
    + '</div>'
    + '<div class="auth-card">'
    + when(!devices.length, '<label class="check auth-keep"><input type="checkbox" id="cs_skip">Cadastrar os aparelhos depois</label>')
    + '<button class="primary btn-lg block" id="cs_done">Concluir configuração'
    + when(devices.length, ' (' + plural(devices.length, 'aparelho', 'aparelhos') + ')') + '</button>'
    + '<p class="auth-switch">Dá para cadastrar mais aparelhos e criar categorias depois, na aba Empresa e na Área de Trabalho.</p>'
    + '</div></section>';
}
