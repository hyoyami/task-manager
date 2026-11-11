/* ==========================================================================
   Inicialização: obtém o banco e o login do back-end ativo (js/runtime/),
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
    state.db = await claude.use('db');
    state.auth = await claude.use('auth');
    if (!state.db || !state.auth) {
      $('#app').innerHTML = '<div class="card">Não foi possível conectar ao banco de dados. Verifique a internet e recarregue a página.</div>';
      return;
    }
    const saved = await state.auth.restore();
    if (saved) startSession(saved);
    else render();
  } catch (err) {
    console.error(err);
    $('#app').innerHTML = '<div class="card">Não foi possível carregar o sistema.</div>';
  }
}

boot();
