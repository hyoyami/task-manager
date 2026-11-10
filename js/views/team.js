/* ==========================================================================
   Aba Equipe (solicitante): funcionários, disponibilidade agora e atalhos.
   ========================================================================== */
'use strict';

const AVAILABILITY_ORDER = ['free', 'busy', 'off'];

function employeeCard({ p, status }) {
  const av = AVAILABILITY[status.k];
  const active = allTasks().filter((t) => t.emp === p.id && ['aguardando', 'pendente', 'agendada'].includes(t.status)).length;
  const cats = savedCategories(p.ws);
  const cargo = p.ws?.cargo;
  return '<div class="card"><div class="row between">'
    + '<div class="row nowrap">' + avatar(p.id, p.name, 34)
    + '<div><b>' + esc(p.name) + '</b><div class="muted">' + esc(status.x) + ' · ' + active + ' tarefa(s) ativa(s)</div></div></div>'
    + '<span class="nowrap-text"><span class="dot" style="background:' + av.color + '"></span><b>' + av.label + '</b></span></div>'
    + when(cargo, '<div class="muted mt-6"><b>' + esc((CARGOS[cargo] || { n: cargo }).n) + '</b></div>')
    + when(cats.length, '<div class="row gap-sm mt-6">' + each(cats, (c) => tag(categoryIcon(c) + esc(c.name))) + '</div>')
    + '<div class="row actions"><button class="small primary" data-send="' + p.id + '">Enviar tarefa</button>'
    + '<button class="small" data-ag="' + p.id + '">Ver agenda</button></div></div>';
}

function viewTeam() {
  const list = employees()
    .map((p) => ({ p, status: employeeStatus(p.id) }))
    .sort((a, b) => AVAILABILITY_ORDER.indexOf(a.status.k) - AVAILABILITY_ORDER.indexOf(b.status.k)
      || String(a.p.name).localeCompare(String(b.p.name)));
  const legend = '<div class="row gap-lg muted toolbar">'
    + each(AVAILABILITY_ORDER, (k) => '<span><span class="dot" style="background:' + AVAILABILITY[k].color + '"></span>' + AVAILABILITY[k].label + '</span>')
    + '</div>';
  return '<h1>Equipe</h1>' + legend + (each(list, employeeCard) || emptyCard('Nenhum funcionário cadastrado ainda.'));
}
