/* ==========================================================================
   Aba Tarefas (ativas / histórico) e formulário "Nova tarefa" (solicitante).
   ========================================================================== */
'use strict';

function viewTasks() {
  const history = ui.taskFilter === 'hist';
  const mine = (t) => (isEmployee() ? t.emp === state.uid : t.req === state.uid);
  const statuses = history ? FINISHED : ['aguardando', 'pendente', 'agendada'];
  const list = allTasks()
    .filter((t) => mine(t) && statuses.includes(t.status))
    .sort((a, b) => (history ? finishedAt(b) - finishedAt(a) : b.created - a.created));

  return '<div class="row toolbar">'
    + '<button class="small' + when(!history, ' primary') + '" data-tf="ativas">Ativas</button>'
    + '<button class="small' + when(history, ' primary') + '" data-tf="hist">Histórico</button></div>'
    + (each(list, (t) => (history ? finishedRow(t) : taskCard(t, { canControl: isEmployee() })))
      || emptyCard(history ? 'Nenhuma tarefa concluída ou cancelada.' : 'Nenhuma tarefa ativa.'));
}

/** Aparelhos ordenados por responsável, categoria e nome (para o seletor). */
function devicesForSelect() {
  const s = (v) => String(v || '');
  return Object.values(state.devices).sort((a, b) =>
    s(nameOf(a.owner)).localeCompare(s(nameOf(b.owner))) || s(a.area).localeCompare(s(b.area)) || s(a.name).localeCompare(s(b.name)));
}

/** Botões de problemas pré-definidos da categoria do aparelho escolhido. */
function problemPicker(deviceId) {
  const d = state.devices[deviceId];
  if (!d) {
    return '<label>Problema do aparelho</label><p class="muted">Selecione um aparelho acima para ver os problemas da categoria.</p>';
  }
  const list = problemsOf(state.profiles[d.owner]?.ws, d.area);
  if (!list.length) {
    return '<label>Problema do aparelho</label><p class="muted">A categoria ' + esc(d.area)
      + ' ainda não tem problemas pré-definidos. Descreva o problema normalmente.</p>';
  }
  return '<label>Problema da categoria ' + esc(d.area) + '</label><input type="hidden" id="f_k" value="">'
    + '<div class="row">' + each(list, (n) => '<button type="button" class="small" data-pk="' + esc(n) + '">' + esc(n) + '</button>') + '</div>'
    + '<p class="muted">Toque no problema, ou deixe sem selecionar para descrever outro problema.</p>';
}

function newTaskForm() {
  const emps = employees();
  return '<h1>Nova tarefa</h1><div class="card">'
    + '<label>Título</label><input type="text" id="f_t">'
    + '<label>Descrição breve</label><textarea id="f_d" rows="2"></textarea>'
    + '<label>Funcionário(s) responsável(is)</label>'
    + (each(emps, (e) => '<label class="check"><input type="checkbox" class="f_e" value="' + e.id + '"'
      + when(e.id === ui.presetEmp, ' checked') + '>' + esc(e.name) + '</label>')
      || '<span class="muted">Nenhum funcionário cadastrado.</span>')
    + '<label>Vincular aparelho para manutenção (opcional)</label><select id="f_v"><option value="">Sem aparelho</option>'
    + each(devicesForSelect(), (d) => '<option value="' + d.id + '">' + esc(d.name) + ' · ' + esc(d.area)
      + when(d.ip, ' · ' + esc(d.ip)) + ' — ' + esc(nameOf(d.owner)) + '</option>')
    + '</select><p class="muted">Ao vincular um aparelho, a tarefa vira de manutenção e vai para o responsável por ele.</p>'
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
    // Tarefa de manutenção: vai para o responsável pelo aparelho.
    form.emps = [device.owner];
    form.link = { dev: device.id, devName: device.name, devArea: device.area, devIp: device.ip || '', tipo: 'manutencao' };
    const problem = $('#f_k')?.value || '';
    if (problem) {
      form.link.preset = problem;
      if (!form.title) form.title = problem;
      if (!form.desc) form.desc = problem + ' — ' + device.name;
    }
    if (form.title && !/^Manuten/.test(form.title)) form.title = 'Manutenção: ' + form.title;
  }
  if (!form.title || !form.desc || !form.emps.length) return { error: 'Informe título, descrição e ao menos um funcionário.' };
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
