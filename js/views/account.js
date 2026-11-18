/* ==========================================================================
   Configurações da conta, tema, horário de trabalho, folgas e tela de login.
   ========================================================================== */
'use strict';

// ---------- Tema ----------
const THEME_KEY = 'theme';
const currentTheme = () => document.documentElement.dataset.theme || 'light';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.set(THEME_KEY, theme);
}

function themeCard() {
  const t = currentTheme();
  return '<div class="card"><b>Tema</b><p class="muted">Escolha a aparência do sistema.</p><div class="row">'
    + '<button class="small' + when(t === 'light', ' primary') + '" data-th="light">Normal (claro)</button>'
    + '<button class="small' + when(t === 'dark', ' primary') + '" data-th="dark">Noturno (escuro)</button></div></div>';
}

// ---------- Configurações da conta ----------
function viewAccount() {
  const me = state.me;
  return '<h1>Configurações da conta</h1>' + themeCard()
    + '<div class="card"><b>Dados</b><label>Nome</label><input type="text" id="p_n" value="' + esc(me.name) + '">'
    + '<label for="p_u">Nome de usuário</label><input type="text" id="p_u" maxlength="30" autocapitalize="none" spellcheck="false" value="' + esc(me.username || '') + '">'
    + '<p><button class="primary" id="p_go">Salvar</button></p></div>'
    + '<div class="card"><b>E-mail</b><div class="muted">' + esc(me.email || '—') + '</div>'
    + '<label>Novo e-mail</label><input type="text" id="em_n" inputmode="email" autocomplete="email">'
    + '<label>Senha atual</label><input type="password" id="em_p" autocomplete="current-password">'
    + '<p><button class="small primary" id="em_go">Alterar e-mail</button></p></div>'
    + '<div class="card"><b>Senha</b>'
    + '<label>Senha atual</label><input type="password" id="pw_c" autocomplete="current-password">'
    + '<label>Nova senha</label><input type="password" id="pw_n" autocomplete="new-password">'
    + '<p><button class="small primary" id="pw_go">Alterar senha</button></p></div>'
    + when(isEmployee(), '<p class="row"><button class="small" data-go="folgas">Horário de trabalho e folgas</button>'
      + when(state.me.role === 'func', '<button class="small" data-go="wcfg">Configurações de trabalho</button>') + '</p>')
    + '<div class="card danger-zone"><b>Excluir conta</b>'
    + (ownsCompany()
      ? '<p class="muted">Você é o administrador de <b>' + esc(state.company?.name || 'uma empresa') + '</b>. '
        + 'Para excluir a sua conta, exclua a empresa antes (aba Empresa).</p>'
      : '<p class="muted">Apaga a sua conta e o seu acesso. Tarefas abertas que você pediu são canceladas; '
        + 'as que você executaria voltam a ficar abertas para a equipe. Não dá para desfazer.</p>'
        + '<p class="mb-0"><button class="small danger" id="xa_open">Excluir minha conta</button></p>')
    + '</div>';
}

/** O usuário logado é o administrador (dono) de uma empresa? */
const ownsCompany = () => Object.values(state.companies).some((c) => c.admin === state.uid);

// ---------- Horário de trabalho e folgas ----------
const timeField = (id, label, value) =>
  '<div><label for="' + id + '">' + label + '</label><input type="time" id="' + id + '" value="' + esc(value) + '"></div>';

function workHoursCard(p) {
  return '<div class="card"><b>Horário de trabalho</b>'
    + '<p class="muted">Defina sua jornada diária e o intervalo para almoço. A agenda só usa horários dentro dela.</p>'
    + '<div class="grid-2">' + timeField('p_s', 'Entrada', p.start) + timeField('p_e', 'Saída', p.end) + '</div>'
    + '<label class="check"><input type="checkbox" id="p_nb"' + when(p.noBreak, ' checked') + '>'
    + 'Não tenho horário fixo de almoço</label>'
    + '<p class="muted">Marcado, a agenda não reserva o almoço: você usa o botão <b>Iniciar intervalo</b> na Agenda quando parar.</p>'
    + '<div class="grid-2 lunch-fields"' + when(p.noBreak, ' hidden') + '>' + timeField('p_bs', 'Almoço — início', p.bs) + timeField('p_be', 'Almoço — fim', p.be) + '</div>'
    + '<p><button class="primary" id="wh_go">Salvar horário</button></p></div>';
}

/** "Ausente hoje": folga só do dia de hoje; as tarefas de hoje vão para o dia seguinte. */
function absentCard(p) {
  const day = startOfDay(Date.now());
  const today = new Date(day).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  if (isAbsentOn(p, day)) {
    return '<div class="card"><b>Ausente hoje</b><p class="muted mb-0">Você está marcado como <b>ausente</b> hoje (' + esc(today)
      + '). Para desfazer, remova a folga "Ausente" na lista abaixo.</p></div>';
  }
  const n = scheduledOnDay(day).length;
  return '<div class="card"><b>Ausente hoje</b>'
    + '<p class="muted">Não vai trabalhar hoje (' + esc(today) + ')? Marque o dia como ausente: vale só para hoje, e '
    + (n ? 'as <b>' + plural(n, 'tarefa agendada', 'tarefas agendadas') + '</b> para hoje vão' : 'as tarefas agendadas para hoje iriam')
    + ' para o dia seguinte.</p>'
    + '<p class="mb-0"><button class="danger" id="ab_open">Marcar hoje como ausente</button></p></div>';
}

function viewTimeOff() {
  const p = profileOf(state.uid);
  return '<h1>Horário de trabalho e folgas</h1>' + workHoursCard(p)
    + '<div class="card"><b>Folga semanal</b>'
    + '<p class="muted">Marque os dias da semana em que você não trabalha (ex.: sábado e domingo).</p><div class="row gap-lg">'
    + each(WEEKDAYS_SHORT, (n, i) => '<label class="check day"><input type="checkbox" class="wk" value="' + i + '"'
      + when((p.wk || []).includes(i), ' checked') + '>' + n + '</label>')
    + '</div><p><button class="primary" id="wk_go">Salvar folga semanal</button></p></div>'
    + absentCard(p)
    + '<h2>Folgas pontuais</h2><div class="card"><div class="row">'
    + '<div><label>De</label><input type="date" id="o_s"></div><div><label>Até</label><input type="date" id="o_e"></div></div>'
    + '<label>Motivo</label><input type="text" id="o_n"><p><button class="small" id="o_go">Adicionar</button></p>'
    + each(p.off || [], (o, i) => (o.brk ? '' : '<div class="row between muted"><span>' + fmtDay(o.s) + ' → ' + fmtDay(o.e - 1) + ' ' + esc(o.note || '')
      + '</span><button class="small danger" data-rm="' + i + '">Remover</button></div>'))
    + '</div>';
}

// ---------- Login / cadastro ----------
/** Cadastro feito: falta confirmar o e-mail pelo link enviado. */
function viewConfirmEmail() {
  return '<section class="auth">'
    + '<h1 class="brand-login">TASK MANAGER</h1>'
    + '<div class="auth-card">'
    + '<h2 class="auth-title">Confirme seu e-mail</h2>'
    + '<p class="auth-lead">Enviamos um link de confirmação para <b>' + esc(ui.pendingEmail) + '</b>.</p>'
    + '<p class="muted">Abra o e-mail e toque em <b>Confirmar e-mail</b>. Depois volte aqui e entre com seu e-mail '
    + '(ou nome de usuário) e senha. Não chegou? Veja a caixa de spam ou reenvie.</p>'
    + '<button class="primary btn-lg block" id="a_back">Já confirmei — entrar</button>'
    + '<button class="btn-lg block" id="a_resend">Reenviar e-mail</button>'
    + '</div></section>';
}

function viewLogin() {
  if (ui.authMode === 'check') return viewConfirmEmail();
  const signup = ui.authMode === 'up';
  return '<section class="auth">'
    + '<h1 class="brand-login">TASK MANAGER</h1>'
    + when(pendingInvite(), '<div class="auth-note"><b>Você recebeu um convite!</b>'
      + '<p class="muted mb-0">Crie sua conta (ou entre) e você já entra na empresa que te convidou.</p></div>')
    + '<div class="auth-card">'
    + '<h2 class="auth-title">' + (signup ? 'Criar conta' : 'Entrar') + '</h2>'
    + when(signup, '<label for="a_n">Nome</label><input type="text" id="a_n" autocomplete="name">'
      + '<label for="a_u">Nome de usuário</label><input type="text" id="a_u" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="ex.: ana.souza">')
    + '<label for="a_e">' + (signup ? 'E-mail' : 'E-mail ou nome de usuário') + '</label>'
    + '<input type="text" id="a_e" ' + (signup ? 'inputmode="email" autocomplete="email"' : 'autocomplete="username"') + ' autocapitalize="none" spellcheck="false">'
    + '<label for="a_p">Senha</label><input type="password" id="a_p" autocomplete="' + (signup ? 'new-password' : 'current-password') + '">'
    + when(signup && !pendingInvite(), '<p class="muted auth-hint">Depois do cadastro você escolhe a empresa (ou cadastra a sua).</p>')
    + '<label class="check auth-keep"><input type="checkbox" id="a_k">Manter conectado</label>'
    + '<p class="auth-error" id="a_m" role="alert">' + esc(ui.authMsg) + '</p>'
    + '<button class="primary btn-lg block" id="a_go">' + (signup ? 'Criar conta' : 'Entrar') + '</button>'
    + '<p class="auth-switch">' + (signup ? 'Já tem conta?' : 'Ainda não tem conta?')
    + ' <button class="link" id="a_mode">' + (signup ? 'Entrar' : 'Criar conta') + '</button></p>'
    + '</div></section>';
}
