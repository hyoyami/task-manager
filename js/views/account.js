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
      + '<button class="small" data-go="wcfg">Workstation configuração</button></p>');
}

// ---------- Horário de trabalho e folgas ----------
const timeField = (id, label, value) =>
  '<div><label for="' + id + '">' + label + '</label><input type="time" id="' + id + '" value="' + esc(value) + '"></div>';

function workHoursCard(p) {
  return '<div class="card"><b>Horário de trabalho</b>'
    + '<p class="muted">Defina sua jornada diária e o intervalo para almoço. A agenda só usa horários dentro dela.</p>'
    + '<div class="grid-2">' + timeField('p_s', 'Entrada', p.start) + timeField('p_e', 'Saída', p.end) + '</div>'
    + '<div class="grid-2">' + timeField('p_bs', 'Almoço — início', p.bs) + timeField('p_be', 'Almoço — fim', p.be) + '</div>'
    + '<p><button class="primary" id="wh_go">Salvar horário</button></p></div>';
}

function viewTimeOff() {
  const p = profileOf(state.uid);
  return '<h1>Horário de trabalho e folgas</h1>' + workHoursCard(p)
    + '<div class="card"><b>Folga semanal</b>'
    + '<p class="muted">Marque os dias da semana em que você não trabalha (ex.: sábado e domingo).</p><div class="row gap-lg">'
    + each(WEEKDAYS_SHORT, (n, i) => '<label class="check day"><input type="checkbox" class="wk" value="' + i + '"'
      + when((p.wk || []).includes(i), ' checked') + '>' + n + '</label>')
    + '</div><p><button class="primary" id="wk_go">Salvar folga semanal</button></p></div>'
    + '<h2>Folgas pontuais</h2><div class="card"><div class="row">'
    + '<div><label>De</label><input type="date" id="o_s"></div><div><label>Até</label><input type="date" id="o_e"></div></div>'
    + '<label>Motivo</label><input type="text" id="o_n"><p><button class="small" id="o_go">Adicionar</button></p>'
    + each(p.off || [], (o, i) => '<div class="row between muted"><span>' + fmtDay(o.s) + ' → ' + fmtDay(o.e - 1) + ' ' + esc(o.note || '')
      + '</span><button class="small danger" data-rm="' + i + '">Remover</button></div>')
    + '</div>';
}

// ---------- Login / cadastro ----------
function viewLogin() {
  const signup = ui.authMode === 'up';
  return '<h1 class="brand-login">TASK MANAGER</h1><div class="card"><b>' + (signup ? 'Criar conta' : 'Entrar') + '</b>'
    + when(signup, '<label>Nome</label><input type="text" id="a_n" autocomplete="name">')
    + '<label>E-mail</label><input type="text" id="a_e" inputmode="email" autocomplete="email">'
    + '<label>Senha</label><input type="password" id="a_p" autocomplete="' + (signup ? 'new-password' : 'current-password') + '">'
    + when(signup, '<label>Tipo de usuário</label><select id="a_r"><option value="sol">Solicitante</option><option value="func">Funcionário</option></select>')
    + '<label class="check check-lg"><input type="checkbox" id="a_k">Manter conectado</label>'
    + '<p class="muted error" id="a_m">' + esc(ui.authMsg) + '</p>'
    + '<div class="row between"><button class="primary" id="a_go">' + (signup ? 'Cadastrar' : 'Entrar') + '</button>'
    + '<button class="small" id="a_mode">' + (signup ? 'Já tenho conta' : 'Criar conta') + '</button></div></div>';
}
