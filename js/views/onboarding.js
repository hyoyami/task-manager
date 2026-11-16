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
    + '<button class="primary btn-lg block" id="ob_create">Criar empresa</button></div>';

  // Sem empresas na lista, só faz sentido cadastrar a sua (ou usar um convite).
  return wrap(head + '<p class="auth-lead">Para começar, entre na sua empresa ou cadastre uma nova.</p>'
    + (companies.length ? joinCard + createCard
      : createCard + '<p class="auth-switch">Tem um link de convite? Abra o link e você entra direto.</p>'));
}
