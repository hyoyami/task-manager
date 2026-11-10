/* ==========================================================================
   Constantes de domínio: prioridades, status, cargos, categorias e problemas.
   ========================================================================== */
'use strict';

const PRIORITY_ORDER = { alta: 0, neutra: 1, baixa: 2 };
const PRIORITY_LABEL = { alta: 'Alta', neutra: 'Neutra', baixa: 'Baixa' };

/** Ciclo de vida: aguardando → pendente/agendada → andamento ⇄ pausada → concluida | cancelada. */
const STATUS_LABEL = {
  aguardando: 'Aguardando aceite',
  pendente: 'Pendente',
  agendada: 'Agendada',
  andamento: 'Em andamento',
  pausada: 'Pausada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

/** Status que ocupam um horário na agenda. */
const OCCUPYING = ['agendada', 'andamento', 'pausada'];
/** Status ainda sem horário (aguardando aceite ou sem vaga). */
const UNSCHEDULED = ['aguardando', 'pendente'];
/** Status finais. */
const FINISHED = ['concluida', 'cancelada'];

/** Jornada padrão de um funcionário recém-cadastrado. */
const DEFAULT_SCHEDULE = { start: '08:00', end: '17:00', bs: '12:00', be: '13:00', off: [] };

/** Opções do seletor de duração (minutos). */
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];
/** Granularidade do agendamento automático e da duração mínima (minutos). */
const SLOT_ROUND = 15;
/** Tamanho dos blocos "livre" exibidos na agenda (minutos). */
const SLOT_STEP = 30;

const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const DEVICE_STATUSES = ['Operacional', 'Em manutenção', 'Fora de uso'];
const DEVICE_STATUS_STYLE = {
  'Operacional': { color: '#22c55e', label: 'operacional' },
  'Em manutenção': { color: '#f59e0b', label: 'em manutenção' },
  'Fora de uso': { color: '#ef4444', label: 'fora de uso' },
};

/** Disponibilidade exibida na aba Equipe. */
const AVAILABILITY = {
  free: { label: 'Disponível', color: '#16a34a' },
  busy: { label: 'Ocupado', color: '#eab308' },
  off: { label: 'Indisponível', color: '#dc2626' },
};

/** Cargos e as categorias de aparelho sugeridas para cada um. */
const CARGOS = {
  ti: {
    n: 'TI (Técnico de informática)',
    cats: [
      { name: 'Impressora', icon: '🖨️' },
      { name: 'Computador', icon: '💻' },
      { name: 'Raspberry Pi', icon: '🍓' },
      { name: 'Orange Pi', icon: '🍊' },
      { name: 'Móvel 0', icon: '📱' },
      { name: 'Móvel 1', icon: '📱' },
      { name: 'Móvel 2', icon: '📱' },
      { name: 'Móvel 3', icon: '📱' },
    ],
  },
};

const DEFAULT_CATEGORY_ICON = '📦';

/** Problemas de manutenção de fábrica, por categoria (o funcionário pode editar). */
const PRESETS = {
  Impressora: ['Encravamento', '3B', 'Limpeza', 'Esvaziar Impressora', 'Trocar Cabeçote'],
};
