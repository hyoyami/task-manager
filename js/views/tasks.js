/* ==========================================================================
   Aba Tarefas (ativas / histórico) e formulário "Nova tarefa" (solicitante e administrador).
   ========================================================================== */
'use strict';

const UNLINKED = '__none'; // filtro "Vinculada a: sem usuário vinculado"

function viewTasks() {
  const history = ui.taskFilter === 'hist';
  // Funcionário: as que executa; solicitante: as que pediu; administrador: ambas.
  const role = state.me.role;
  const mine = (t) => (role !== 'sol' && t.emp === state.uid) || (role !== 'func' && t.req === state.uid);
  const toolbar = '<div class="row toolbar">'
    + '<button class="small' + when(!history, ' primary') + '" data-tf="ativas">Ativas</button>'
    + '<button class="small' + when(history, ' primary') + '" data-tf="hist">Histórico</button></div>';

  if (history) {
    const done = allTasks().filter((t) => mine(t) && FINISHED.includes(t.status)).sort((a, b) => finishedAt(b) - finishedAt(a));
    return toolbar + (each(done, finishedRow) || emptyCard('Nenhuma tarefa concluída ou cancelada.'));
  }

  // Ativas: as minhas + as abertas para a equipe que posso assumir. Sem usuário vinculado ficam no final.
  const active = ['aguardando', 'pendente', 'agendada', 'programada'];
  const byId = {};
  allTasks().filter((t) => mine(t) && active.includes(t.status)).forEach((t) => { byId[t.id] = t; });
  openTasksForMe().forEach((t) => { byId[t.id] = t; });
  const all = Object.values(byId);

  // Filtros: quem criou (solicitante) e a quem está vinculada (responsável).
  const byName = (a, b) => (a === state.uid ? -1 : b === state.uid ? 1 : String(nameOf(a)).localeCompare(String(nameOf(b))));
  const creators = [...new Set(all.map((t) => t.req).filter(Boolean))].sort(byName);
  const assignees = [...new Set(all.map((t) => t.emp).filter(Boolean))].sort(byName);
  if (ui.taskReq && !creators.includes(ui.taskReq)) ui.taskReq = '';
  if (ui.taskEmp && ui.taskEmp !== UNLINKED && !assignees.includes(ui.taskEmp)) ui.taskEmp = '';
  const { taskReq: req, taskEmp: emp } = ui;
  const pass = (t) => (!req || t.req === req) && (!emp || (emp === UNLINKED ? !t.emp : t.emp === emp));
  const order = (a, b) => (a.status === 'programada') - (b.status === 'programada') || b.created - a.created;
  const linked = all.filter((t) => t.emp && pass(t)).sort(order);
  const unlinked = all.filter((t) => !t.emp && pass(t)).sort(order);

  const person = (id) => esc(nameOf(id)) + when(id === state.uid, ' (você)');
  const select = (id, label, value, people, extra = '') => '<div><label for="' + id + '">' + label + '</label>'
    + '<select id="' + id + '" data-live><option value="">Todos</option>'
    + each(people, (p) => '<option value="' + esc(p) + '"' + when(p === value, ' selected') + '>' + person(p) + '</option>') + extra
    + '</select></div>';
  const hasUnlinked = all.some((t) => !t.emp);
  const filters = all.length ? '<div class="task-filter"><div class="grid-2">'
    + select('tf_r', 'Criada por', req, creators)
    + select('tf_e', 'Vinculada a', emp, assignees,
      when(hasUnlinked || emp === UNLINKED, '<option value="' + UNLINKED + '"' + when(emp === UNLINKED, ' selected') + '>Sem usuário vinculado</option>'))
    + '</div>' + when(req || emp, '<p class="muted">' + plural(linked.length + unlinked.length, 'tarefa', 'tarefas')
      + ' no filtro · <button class="link" data-tfclear="1">limpar filtros</button></p>') + '</div>' : '';

  const card = (t) => (canTakeTask(t) ? openTaskCard(t) : taskCard(t, { canControl: t.emp === state.uid }));
  return toolbar + filters
    + each(linked, card)
    + when(unlinked.length, '<h2 class="unlinked-head">Sem usuário vinculado</h2>'
      + '<p class="muted">Abertas para a equipe: ainda ninguém assumiu. O primeiro que aceitar fica com ela.</p>'
      + each(unlinked, card))
    + (linked.length || unlinked.length ? ''
      : emptyCard(req || emp ? 'Nenhuma tarefa ativa com esses filtros.' : 'Nenhuma tarefa ativa.'));
}

/** Aparelhos da empresa ordenados por categoria e nome (para o seletor). */
function devicesForSelect() {
  const s = (v) => String(v || '');
  return Object.values(state.devices).sort((a, b) => s(a.area).localeCompare(s(b.area)) || s(a.name).localeCompare(s(b.name)));
}

/**
 * Quem pode receber a tarefa: todos que executam tarefas; com aparelho vinculado,
 * só quem atende a categoria dele (pela função). Um único possível já vem marcado.
 */
function employeePicker(deviceId) {
  const d = state.devices[deviceId];
  const list = d ? eligibleEmployees(d.area) : employees();
  const label = d ? 'Quem vai atender (função que cuida de ' + esc(d.area) + ')' : 'Funcionário(s) responsável(is)';
  const open = d ? 'todos que atendem ' + esc(d.area) : 'todos que atendem o tipo escolhido abaixo';
  return '<label>' + label + '</label>'
    + (each(list, (e) => '<label class="check"><input type="checkbox" class="f_e" value="' + e.id + '"'
      + when(e.id === ui.presetEmp, ' checked') + '>' + esc(e.name) + when(e.id === state.uid, ' (você)')
      + when(e.role === 'admin', ' <span class="muted">· administrador</span>') + '</label>')
      || '<span class="muted">' + (d ? 'Nenhum funcionário atende esta categoria.' : 'Nenhum funcionário cadastrado.') + '</span>')
    + '<p class="muted">Sem ninguém marcado, a tarefa fica <b>aberta para a equipe</b>: aparece para ' + open
    + ' e o administrador; o primeiro que aceitar fica com ela.</p>'
    + when(!d, '<label for="f_cat">Tipo de tarefa (para tarefa aberta)</label><select id="f_cat"><option value="">Geral — qualquer funcionário</option>'
      + each(companyCategories(), (c) => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>') + '</select>');
}

/** Botões de problemas pré-definidos da categoria do aparelho escolhido. */
function problemPicker(deviceId) {
  const d = state.devices[deviceId];
  if (!d) {
    return '<label>Problema do aparelho</label><p class="muted">Selecione um aparelho acima para ver os problemas da categoria.</p>';
  }
  const list = problemsOf(d.area);
  if (!list.length) {
    return '<label>Problema do aparelho</label><p class="muted">A categoria ' + esc(d.area)
      + ' ainda não tem problemas pré-definidos. Descreva o problema normalmente.</p>';
  }
  return '<label>Problema da categoria ' + esc(d.area) + '</label><input type="hidden" id="f_k" value="">'
    + '<div class="row">' + each(list, (n) => {
      const rec = problemRecurrence(d.area, n);
      return '<button type="button" class="small" data-pk="' + esc(n) + '"'
        + (rec ? ' title="Periódico: ' + recurrenceLabel(rec) + '">' + esc(n) + ' ⟳' : '>' + esc(n)) + '</button>';
    }) + '</div>'
    + '<p class="muted">Toque no problema, ou deixe sem selecionar para descrever outro problema.</p>';
}

function newTaskForm() {
  return '<h1>Nova tarefa</h1><div class="card">'
    + '<label>Título</label><input type="text" id="f_t">'
    + '<label>Descrição breve</label><textarea id="f_d" rows="2"></textarea>'
    + '<label>Vincular aparelho para manutenção (opcional)</label><select id="f_v"><option value="">Sem aparelho</option>'
    + each(devicesForSelect(), (d) => '<option value="' + d.id + '">' + esc(d.name) + ' · ' + esc(d.area)
      + when(d.ip, ' · ' + esc(d.ip)) + '</option>')
    + '</select><p class="muted">Ao vincular um aparelho, a tarefa vira de manutenção e só quem atende a categoria dele pode recebê-la.</p>'
    + '<div id="f_ebox">' + employeePicker('') + '</div>'
    + '<div id="f_kbox">' + problemPicker('') + '</div>'
    + '<div id="f_rbox">' + recurrencePicker('') + '</div>'
    + '<label>Prioridade</label><select id="f_p"><option value="neutra">Neutra</option><option value="alta">Alta</option><option value="baixa">Baixa</option></select>'
    + '<p class="muted">A duração será definida pelo funcionário ao agendar.</p>'
    + '<p class="muted error" id="f_m"></p><button class="primary" id="f_go">Enviar tarefa</button></div>';
}

/** Lê o formulário "Nova tarefa". Retorna o objeto para createTasks() ou uma mensagem de erro. */
function readNewTaskForm() {
  const form = {
    title: $('#f_t').value.trim(),
    desc: $('#f_d').value.trim(),
    prio: $('#f_p').value,
    emps: $$('.f_e:checked').map((x) => x.value),
    link: {},
  };
  const device = state.devices[$('#f_v')?.value || ''];
  if (device) {
    // Tarefa de manutenção: só para quem atende a categoria do aparelho.
    const eligible = new Set(eligibleEmployees(device.area).map((p) => p.id));
    form.emps = form.emps.filter((id) => eligible.has(id));
    form.link = { dev: device.id, devName: device.name, devArea: device.area, devIp: device.ip || '', tipo: 'manutencao' };
    const problem = $('#f_k')?.value || '';
    if (problem) {
      form.link.preset = problem;
      if (!form.title) form.title = problem;
      if (!form.desc) form.desc = problem + ' — ' + device.name;
    }
    if (form.title && !/^Manuten/.test(form.title)) form.title = 'Manutenção: ' + form.title;
    const { rec, error } = readRecurrence('f');
    if (error) return { error };
    if (rec) {
      form.rec = rec;
      form.prio = 'alta';
    }
  }
  if (!device && !form.emps.length) form.cat = $('#f_cat')?.value || null;
  if (!form.title || !form.desc) return { error: 'Informe título e descrição.' };
  return { form };
}

/** Campos do aviso periódico (ids <prefixo>_rc / _rn / _ru), já preenchidos com `rec` se houver. */
function recurrenceFields(prefix, rec = null) {
  const unit = rec?.u || 'm';
  return '<label class="check"><input type="checkbox" id="' + prefix + '_rc"' + when(rec, ' checked') + '>Definir aviso (manutenção periódica)</label>'
    + '<div class="row nowrap recurrence"><span>A cada</span>'
    + '<input type="number" id="' + prefix + '_rn" min="1" max="999" value="' + (rec?.n || 1) + '" inputmode="numeric" aria-label="Intervalo">'
    + '<select id="' + prefix + '_ru" aria-label="Unidade">'
    + each(Object.entries(RECURRENCE_UNITS), ([u, [, many]]) => '<option value="' + u + '"' + when(u === unit, ' selected') + '>' + many + '</option>')
    + '</select></div>';
}

/** Lê os campos do aviso: { rec } (null se desmarcado) ou { error }. */
function readRecurrence(prefix) {
  if (!$('#' + prefix + '_rc')?.checked) return { rec: null };
  const n = Math.floor(+$('#' + prefix + '_rn').value);
  if (!(n >= 1 && n <= 999)) return { error: 'Informe o intervalo do aviso (1 a 999).' };
  return { rec: { n, u: $('#' + prefix + '_ru').value } };
}

/** Liga/desliga o aviso na Nova tarefa (manutenção periódica é sempre de prioridade alta). */
function setRecurrenceOn(on) {
  const box = $('#f_rc');
  if (!box) return;
  box.checked = on;
  if (on) $('#f_p').value = 'alta';
  $('#f_p').disabled = on;
}

/** Aviso de manutenção periódica (só com aparelho vinculado). */
function recurrencePicker(deviceId) {
  if (!state.devices[deviceId]) return '';
  return recurrenceFields('f')
    + '<p class="muted">Cria a tarefa agora com prioridade <b>alta</b>; ao ser concluída, a próxima já fica marcada para a data seguinte. '
    + 'Ela não deixa o aparelho inoperante: o status só muda para "Em manutenção" quando for iniciada.</p>';
}

/** Seleciona/deseleciona um problema pré-definido e preenche o título. */
function toggleProblem(name) {
  const hidden = $('#f_k');
  const title = $('#f_t');
  const wasOn = hidden.value === name;
  hidden.value = wasOn ? '' : name;
  $$('[data-pk]').forEach((b) => b.classList.toggle('primary', hidden.value !== '' && b.dataset.pk === hidden.value));
  if (!wasOn) title.value = name;
  else if (title.value === name) title.value = '';
  // Problema com aviso periódico padrão: preenche (ou desfaz) a manutenção periódica.
  const device = state.devices[$('#f_v')?.value || ''];
  const rec = device && hidden.value ? problemRecurrence(device.area, hidden.value) : null;
  const box = $('#f_rc');
  if (!box) return;
  if (rec) {
    $('#f_rn').value = rec.n;
    $('#f_ru').value = rec.u;
    setRecurrenceOn(true);
    box.dataset.auto = '1';
  } else if (box.dataset.auto) {
    setRecurrenceOn(false);
    delete box.dataset.auto;
  }
}
