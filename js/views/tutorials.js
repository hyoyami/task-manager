/* ==========================================================================
   Tutoriais (Menu ☰ → Tutoriais): lista por categoria/problema.
   O passo a passo abre em modal (ver views/modals.js → openTutorial).
   ========================================================================== */
'use strict';

function viewTutorials() {
  return '<h1>Tutoriais</h1><p class="muted">Passo a passo, com fotos, de como executar cada tarefa de manutenção. Toque em um problema para abrir.</p>'
    + each(allCategories(), (cat) => {
      const problems = allProblems(cat);
      return '<h2>' + esc(cat) + '</h2>' + (each(problems, (prob) => {
        const n = tutorialSteps(cat, prob).length;
        return '<div class="card clickable" data-tut="' + esc(cat + '||' + prob) + '"><div class="row between"><b>' + esc(prob) + '</b>'
          + tag(n ? plural(n, 'passo', 'passos') : 'Sem tutorial ainda') + '</div></div>';
      }) || emptyCard('Nenhum problema cadastrado nesta categoria.'));
    });
}
