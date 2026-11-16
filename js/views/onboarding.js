/* ==========================================================================
   Entrada na empresa: depois de criar a conta, a pessoa cria uma empresa
   (vira administradora) ou pede para entrar numa existente. Enquanto o pedido
   não é aceito, fica nesta tela. Quem chega por link de convite entra direto.
   ========================================================================== */
'use strict';

function viewOnboarding() {
  const me = state.me;
  const hello = '<h1>Olá, ' + esc(me.name) + '!</h1>';

  if (me.company && me.status === 'pending') {
    const company = state.companies[me.company];
    return hello + '<div class="card onboarding-wait"><b>Pedido enviado</b>'
      + '<p>Você pediu para entrar em <b>' + esc(company?.name || 'uma empresa') + '</b> como <b>'
      + esc(ROLE_LABEL[me.role] || '—') + '</b>.</p>'
      + '<p class="muted">Assim que o administrador aceitar, o sistema abre automaticamente.</p>'
      + '<p><button class="small danger" id="ob_cancel">Cancelar pedido</button></p></div>';
  }

  const companies = Object.values(state.companies).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return hello + '<p class="muted">Para começar, entre na sua empresa ou cadastre uma nova.</p>'
    + '<div class="card"><b>Entrar em uma empresa</b>'
    + (companies.length
      ? '<label for="ob_company">Empresa</label><select id="ob_company"><option value="">Selecione…</option>'
        + each(companies, (c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>') + '</select>'
        + '<label for="ob_role">Eu sou</label><select id="ob_role">'
        + '<option value="sol">Solicitante — peço tarefas</option><option value="func">Funcionário — executo tarefas</option></select>'
        + '<p class="muted">O administrador da empresa recebe o seu pedido e confirma o seu papel.</p>'
        + '<p><button class="primary" id="ob_join">Pedir para entrar</button></p>'
      : '<p class="muted">Ainda não há empresas cadastradas.</p>')
    + '<p class="muted mb-0">Tem um link de convite? Abra o link e você entra direto.</p></div>'
    + '<div class="card"><b>Cadastrar minha empresa</b>'
    + '<p class="muted">Você será o <b>administrador</b>: cadastra os aparelhos, aceita os membros e define os papéis.</p>'
    + '<label for="ob_cn">Nome da empresa</label><input type="text" id="ob_cn" maxlength="60" placeholder="Ex.: Acme Ltda.">'
    + '<p><button class="primary" id="ob_create">Criar empresa</button></p></div>';
}
