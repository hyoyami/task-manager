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

  /** profiles/<id> → perfil (+ id). */
  profiles: {},
  /** tasks/<id> → tarefa. */
  tasks: {},
  /** Notificações do usuário logado (+ _id). */
  notifs: [],
  /** devices/<id> → todos os aparelhos. */
  devices: {},
  /** Subconjunto de `devices` cujo responsável é o usuário logado. */
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
  /** Sugestão de reorganização pendente de aprovação: [{task, start}]. */
  proposal: null,
  /** Tarefas com histórico expandido: { [id]: true }. */
  openHistory: {},
  /** Aba Tarefas: 'ativas' | 'hist'. */
  taskFilter: 'ativas',
  /** Filtros da aba Aparelhos. */
  deviceFilter: { cat: '', status: '' },
  /** Workstation: 'dev' (lista), 'new' (formulário), 'back1' (voltar ao cargo). */
  wsStep: 'dev',
  /** Exclusão de aparelho aguardando confirmação (id). */
  deviceDeleteArmed: null,
  /** Menu: lista de contas salvas aberta. */
  accountSwitcher: false,
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
  /** Arrasto de aparelho/grupo na Workstation (ver app/device-drag.js). */
  deviceDrag: null,
  /** Cartão selecionado por toque, aguardando o toque num horário livre. */
  selectedTask: null,

  /** Contexto dos modais. */
  modal: {
    doneTaskId: null,
    category: null,
    categoryToDelete: null,
    tutorial: null, // [categoria, problema]
    group: null, // grupo de aparelhos sendo renomeado
  },

  /** Funções para cancelar as assinaturas do banco. */
  unsubscribers: [],
};

/** Zera dados e interface ao sair ou trocar de conta. */
function resetSession() {
  Object.assign(state, { me: null, profiles: {}, tasks: {}, notifs: [], devices: {}, myDevices: {}, tutorials: {} });
  Object.assign(ui, {
    tab: 'agenda',
    agendaEmp: null,
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
const employees = () => Object.values(state.profiles).filter((p) => p.role === 'func');
const isEmployee = () => state.me?.role === 'func';
const allTasks = () => Object.values(state.tasks);
