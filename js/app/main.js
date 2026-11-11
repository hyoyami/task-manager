/* ==========================================================================
   Inicialização: obtém o banco (claude.ai ou local-runtime.js),
   liga os eventos e retoma a sessão salva, se houver.
   ========================================================================== */
'use strict';

/** Telas que mostram o "agora" (Equipe e tarefa em andamento) são redesenhadas a cada 30 s. */
const TEAM_REFRESH_MS = 30 * 1000;

async function boot() {
  initEvents();
  setInterval(() => {
    if (!state.me) return;
    // Equipe: disponibilidade "agora"; Agenda: tempo decorrido/restante da tarefa em andamento.
    if (ui.tab === 'equipe' || (ui.tab === 'agenda' && allTasks().some((t) => t.status === 'andamento'))) render();
  }, TEAM_REFRESH_MS);
  try {
    const user = await claude.use('user');
    state.db = await claude.use('db');
    const userId = user && await user.id();
    if (!state.db || !userId) {
      $('#app').innerHTML = '<div class="card">Abra esta página no claude.ai, com login, para usar o sistema.</div>';
      return;
    }
    const saved = storage.get(SESSION_KEY) || storage.get(SESSION_KEY, sessionStorage);
    if (saved) startSession(saved);
    else render();
  } catch (err) {
    console.error(err);
    $('#app').innerHTML = '<div class="card">Não foi possível carregar o sistema.</div>';
  }
}

boot();
