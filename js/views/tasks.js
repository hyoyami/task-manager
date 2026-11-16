/* ==========================================================================
   Aba Tarefas (ativas / histórico) e formulário "Nova tarefa" (solicitante e administrador).
   ========================================================================== */
'use strict';

function viewTasks() {
  const history = ui.taskFilter === 'hist';
  // Funcionário: as que executa; solicitante: as que pediu; administrador: ambas.
  const role = state.me.role;
  const mine = (t) => (role !== 'sol' && t.emp === state.uid) || (role !== 'func' && t.req === state.uid);
  const statuses = history ? FINISHED : ['aguardando', 'pendente', 'agendada'];
  const list = allTasks()
    .filter((t) => mine(t) && statuses.includes(t.status))
    .sort((a, b) => (history ? finishedAt(b) - finishedAt(a) : b.created - a.created));

  const open = history ? [] : openTasksForMe().sort((a, b) => b.created - a.created);
  return '<div class="row toolbar">'
    + '<button class="small' + when(!history, ' primary') + '" data-tf="ativas">Ativas</button>'
    + '<button class="small' + when(history, ' primary') + '" data-tf="hist">Histórico</button></div>'
    + when(open.length, '<h2>Abertas para a equipe</h2>' + each(open, openTaskCard) + '<h2>Minhas tarefas</h2>')
    + (each(list, (t) => (history ? finishedRow(t) : taskCard(t, { canControl: t.emp === state.uid })))
      || emptyCard(history ? 'Nenhuma tarefa concluída ou cancelada.' : 'Nenhuma tarefa ativa.'));
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
    + '<div class="row">' + each(list, (n) => '<button type="button" class="small" data-pk="' + esc(n) + '">' + esc(n) + '</button>') + '</div>'
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
  }
  if (!device && !form.emps.length) form.cat = $('#f_cat')?.value || null;
  if (!form.title || !form.desc) return { error: 'Informe título e descrição.' };
  return { form };
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
}
