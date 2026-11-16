/* ==========================================================================
   Estado global da aplicação.

   `state` guarda os dados vindos do banco (atualizados em tempo real pelos
   onSnapshot em auth.js) e `ui` guarda o estado da interface. Tudo é
   redesenhado a partir daqui por render() — ver app/render.js.
   ========================================================================== */
'use strict';

const state = {
  /** Banco de dados e login do back-end ativo (js/runtime/: Supabase ou local). */
  db: null,
  auth: null,
  /** Id da conta logada (aid) e seu perfil. */
  uid: null,
  me: null,

  /** Empresa do usuário logado (companies/<id> + id) — só quando ele é membro ativo. */
  company: null,
  /** Todas as empresas (para a lista "pedir para entrar"). */
  companies: {},
  /** Pedidos de entrada pendentes na empresa (visível ao administrador). */
  joinRequests: [],
  /** Links de convite da empresa (administrador): invites/<código>. */
  invites: {},

  /** profiles/<id> → membros ativos da empresa (+ o próprio usuário). */
  profiles: {},
  /** tasks/<id> → tarefa. */
  tasks: {},
  /** Notificações do usuário logado (+ _id). */
  notifs: [],
  /** devices/<id> → aparelhos da empresa. */
  devices: {},
  /** Aparelhos que o usuário logado gerencia na Área de Trabalho (categorias da função dele). */
  myDevices: {},
  /** tutorials/<id> → passo de tutorial. */
  tutorials: {},
};

const ui = {
  tab: 'agenda',
  /** Funcionário cuja agenda está sendo vista (solicitante escolhe). */
  agendaEmp: null,
  /** Dia exibido na agenda (início do dia, ms). */
  agendaDay: startOfDay(Date.now()),
  /** Visão da agenda: 'dia' | 'semana' | 'mes'. */
  agendaView: 'dia',
  /** Sugestão de reorganização pendente de aprovação: [{task, start}]. */
  proposal: null,
  /** Tarefas com histórico expandido: { [id]: true }. */
  openHistory: {},
  /** Aba Tarefas: 'ativas' | 'hist'. */
  taskFilter: 'ativas',
  /** Filtros da aba Aparelhos. */
  deviceFilter: { cat: '', status: '' },
  /** Área de Trabalho: 'dev' (lista), 'new' (formulário), 'back1' (voltar ao cargo). */
  wsStep: 'dev',
  /** Exclusão de aparelho aguardando confirmação (id). */
  deviceDeleteArmed: null,
  /** Menu: lista de contas salvas aberta. */
  accountSwitcher: false,
  /** Duração escolhida em cada tarefa aberta antes de aceitar: { [id]: minutos }. */
  poolDur: {},
  /** Funcionário pré-selecionado ao abrir "Nova tarefa" pela Equipe. */
  presetEmp: null,

  /** Tela de login: 'in' (entrar) | 'up' (criar conta) e mensagem de erro. */
  authMode: 'in',
  authMsg: '',

  /** Notificações: horário da última visualização ao abrir o painel. */
  notifSeenAt: 0,
  /** Ids de notificações já conhecidas (para mostrar pop-up só das novas). */
  knownNotifs: new Set(),
  notifsLoaded: false,

  /** Arrasto de cartão em andamento (ver app/drag.js). */
  drag: null,
  /** Arrasto de aparelho/grupo na Área de Trabalho (ver app/device-drag.js). */
  deviceDrag: null,
  /** Cartão selecionado por toque, aguardando o toque num horário livre. */
  selectedTask: null,

  /** Contexto dos modais. */
  modal: {
    doneTaskId: null,
    category: null,
    /** Problema em edição (índice na lista da categoria). */
    problemIndex: null,
    categoryToDelete: null,
    tutorial: null, // [categoria, problema]
    group: null, // grupo de aparelhos sendo renomeado
  },

  /** Funções para cancelar as assinaturas do banco. */
  unsubscribers: [],
};

/** Zera dados e interface ao sair ou trocar de conta. */
function resetSession() {
  Object.assign(state, {
    me: null, company: null, companies: {}, joinRequests: [], invites: {},
    profiles: {}, tasks: {}, notifs: [], devices: {}, myDevices: {}, tutorials: {},
  });
  Object.assign(ui, {
    tab: 'agenda',
    agendaEmp: null,
    agendaDay: startOfDay(Date.now()),
    agendaView: 'dia',
    proposal: null,
    openHistory: {},
    selectedTask: null,
    wsStep: 'dev',
    deviceDeleteArmed: null,
    accountSwitcher: false,
    presetEmp: null,
  });
}

// ---------- Acesso ao banco ----------
const doc = (path) => state.db.doc(path);
const newDoc = (collection) => state.db.collection(collection).doc();
const updateMyProfile = (patch) => doc('profiles/' + state.uid).update(patch);

/** Perfil com a jornada padrão preenchida. */
const profileOf = (id) => ({ ...DEFAULT_SCHEDULE, ...(state.profiles[id] || {}) });
const nameOf = (id) => state.profiles[id]?.name || '—';
/** Quem executa tarefas (agenda própria): funcionários e o administrador. */
const executes = (p) => p?.role === 'func' || p?.role === 'admin';
const employees = () => Object.values(state.profiles).filter(executes);
const isAdmin = () => state.me?.role === 'admin';
/** Usuário logado executa tarefas (funcionário ou administrador). */
const isEmployee = () => executes(state.me);
/** Usuário logado pede tarefas (solicitante ou administrador). */
const canRequest = () => state.me?.role === 'sol' || state.me?.role === 'admin';
/** Membro ativo de uma empresa (senão, fica na tela de entrada/aprovação). */
const isActiveMember = () => !!(state.me?.company && state.me.status === 'active' && state.company);
const allTasks = () => Object.values(state.tasks);
