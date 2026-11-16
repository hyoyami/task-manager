-- ============================================================================
-- TASK MANAGER — esquema do banco (Supabase / PostgreSQL)
--
-- Multiempresa: cada empresa (companies) só enxerga os próprios dados.
-- Cada coleção do app vira uma tabela com:
--   id    text   — o mesmo id usado no app
--   data  jsonb  — o documento inteiro (mesmo formato descrito no CLAUDE.md)
--   colunas geradas a partir do jsonb (company, emp, req, owner…) para índices e permissões.
--
-- O login é o Supabase Auth: profiles.id = auth.uid().
-- Segurança por linha (RLS) + gatilho que protege empresa/papel/status do perfil.
-- Script idempotente: pode ser executado de novo sem perder dados.
-- ============================================================================

-- ---------- Tabelas ----------
create table if not exists public.companies (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  name       text generated always as (data->>'name') stored,
  admin      text generated always as (data->>'admin') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  id         text primary key,                                  -- código do link
  data       jsonb not null default '{}'::jsonb,
  company    text generated always as (data->>'company') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  role       text generated always as (data->>'role') stored,
  name       text generated always as (data->>'name') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  emp        text generated always as (data->>'emp') stored,    -- funcionário responsável
  req        text generated always as (data->>'req') stored,    -- solicitante
  dev        text generated always as (data->>'dev') stored,    -- aparelho vinculado
  status     text generated always as (data->>'status') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  owner      text generated always as (data->>'owner') stored,  -- quem cadastrou
  status     text generated always as (data->>'status') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifs (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  to_user    text generated always as (data->>'to') stored,
  updated_at timestamptz not null default now()
);

create table if not exists public.tutorials (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  cat        text generated always as (data->>'cat') stored,
  prob       text generated always as (data->>'prob') stored,
  updated_at timestamptz not null default now()
);

-- Empresa e status em todas as tabelas da empresa.
alter table public.profiles  add column if not exists company text generated always as (data->>'company') stored;
alter table public.profiles  add column if not exists status  text generated always as (data->>'status') stored;
alter table public.tasks     add column if not exists company text generated always as (data->>'company') stored;
alter table public.devices   add column if not exists company text generated always as (data->>'company') stored;
alter table public.notifs    add column if not exists company text generated always as (data->>'company') stored;
alter table public.tutorials add column if not exists company text generated always as (data->>'company') stored;

-- Nome de usuário (login alternativo ao e-mail): único, sem diferença de maiúsculas.
alter table public.profiles  add column if not exists username text generated always as (lower(data->>'username')) stored;
create unique index if not exists profiles_username_key on public.profiles (username) where username is not null;

create index if not exists profiles_company_idx  on public.profiles (company);
create index if not exists tasks_company_idx     on public.tasks (company);
create index if not exists tasks_emp_idx         on public.tasks (emp);
create index if not exists tasks_req_idx         on public.tasks (req);
create index if not exists tasks_dev_idx         on public.tasks (dev);
create index if not exists devices_company_idx   on public.devices (company);
create index if not exists notifs_to_idx         on public.notifs (to_user);
create index if not exists tutorials_company_idx on public.tutorials (company);
create index if not exists invites_company_idx   on public.invites (company);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies', 'invites', 'profiles', 'tasks', 'devices', 'notifs', 'tutorials'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------- Funções auxiliares (usadas nas regras) ----------
-- Empresa do usuário logado (só se ele for membro ativo).
create or replace function public.my_company() returns text
language sql stable security definer set search_path = public as $$
  select company from public.profiles where id = auth.uid()::text and status = 'active'
$$;

-- Papel ('admin' | 'func' | 'sol') do usuário logado, se for membro ativo.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()::text and status = 'active'
$$;

-- O usuário logado é o administrador da empresa `cid`?
create or replace function public.is_company_admin(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.companies c where c.id = cid and c.admin = auth.uid()::text)
$$;

-- Mescla `patch` no documento (equivale ao update() do app). Respeita o RLS (security invoker).
create or replace function public.doc_merge(tbl text, doc_id text, patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if tbl not in ('companies', 'invites', 'profiles', 'tasks', 'devices', 'notifs', 'tutorials') then
    raise exception 'Coleção inválida: %', tbl;
  end if;
  execute format('update public.%I set data = data || $1 where id = $2', tbl) using patch, doc_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Documento não existe ou sem permissão: %/%', tbl, doc_id;
  end if;
end $$;

-- Entrar na empresa pelo código do link de convite (o único jeito de virar membro ativo sozinho).
create or replace function public.join_with_invite(code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  me text := auth.uid()::text;
  inv_company text;
  inv_role text;
begin
  if me is null then raise exception 'Faça login para usar o convite.'; end if;
  select data->>'company', data->>'role' into inv_company, inv_role from public.invites where id = code;
  if inv_company is null then raise exception 'Convite inválido ou expirado.'; end if;
  if inv_role not in ('sol', 'func') then raise exception 'Convite inválido.'; end if;
  if exists (select 1 from public.profiles where id = me and status = 'active' and company is not null) then
    raise exception 'Você já participa de uma empresa.';
  end if;
  perform set_config('tm.bypass', 'on', true);
  update public.profiles
     set data = data || jsonb_build_object('company', inv_company, 'role', inv_role, 'status', 'active')
   where id = me;
  perform set_config('tm.bypass', 'off', true);
  return inv_company;
end $$;

-- ---------- Proteção do perfil: empresa, papel e status ----------
-- Num BEFORE trigger as colunas geradas ainda não foram calculadas: lê-se do jsonb.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text := auth.uid()::text;
  old_company text; old_role text; old_status text;
  new_company text := new.data->>'company';
  new_role    text := new.data->>'role';
  new_status  text := new.data->>'status';
begin
  -- Funções internas (convite) e acesso administrativo direto ao banco passam.
  if coalesce(current_setting('tm.bypass', true), '') = 'on' or me is null then return new; end if;

  if tg_op = 'INSERT' then
    -- Cadastro: começa sem empresa (ou já pedindo entrada).
    if new.id <> me or coalesce(new_status, '') not in ('', 'pending') or coalesce(new_role, '') = 'admin' then
      raise exception 'Cadastro inválido.';
    end if;
    return new;
  end if;

  old_company := old.data->>'company';
  old_role    := old.data->>'role';
  old_status  := old.data->>'status';
  if new_company is not distinct from old_company and new_role is not distinct from old_role
     and new_status is not distinct from old_status then
    return new;  -- não mexeu em empresa/papel/status
  end if;

  if new.id <> me then
    -- Administrador da empresa aceitando, mudando papel ou removendo um membro dela.
    if public.is_company_admin(old_company)
       and (new_company is null or new_company = old_company)
       and coalesce(old_role, '') <> 'admin'
       and coalesce(new_role, '') in ('', 'sol', 'func')
       and coalesce(new_status, '') in ('', 'pending', 'active') then
      return new;
    end if;
    raise exception 'Sem permissão para alterar este membro.';
  end if;

  -- O próprio usuário:
  if new_company is not null and new_role = 'admin' and new_status = 'active' and public.is_company_admin(new_company) then
    return new;  -- acabou de criar a empresa
  end if;
  if new_company is not null and new_status = 'pending' and new_role in ('sol', 'func')
     and coalesce(old_status, '') <> 'active' then
    return new;  -- pedido de entrada
  end if;
  if new_company is null and new_status is null and coalesce(old_role, '') <> 'admin' then
    return new;  -- cancelou o pedido ou saiu da empresa
  end if;
  raise exception 'Alteração de empresa, papel ou status não permitida.';
end $$;

-- ---------- Proteção da empresa: o funcionário só mexe em categorias e problemas ----------
create or replace function public.guard_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text := auth.uid()::text;
  k text;
begin
  if coalesce(current_setting('tm.bypass', true), '') = 'on' or me is null or old.data->>'admin' = me then
    return new;
  end if;
  -- Funcionário: nome, administrador e data de criação não mudam…
  if new.data->>'name' is distinct from old.data->>'name'
     or new.data->>'admin' is distinct from old.data->>'admin'
     or new.data->'created' is distinct from old.data->'created' then
    raise exception 'Só o administrador altera os dados da empresa.';
  end if;
  -- …e as funções só podem ganhar categorias (a nova categoria vale para todas), nunca perder ou mudar.
  for k in select jsonb_object_keys(coalesce(old.data->'cargos', '{}'::jsonb)) loop
    if not coalesce(new.data->'cargos', '{}'::jsonb) ? k
       or new.data->'cargos'->k->>'n' is distinct from old.data->'cargos'->k->>'n'
       or not coalesce(new.data->'cargos'->k->'cats', '[]'::jsonb) @> coalesce(old.data->'cargos'->k->'cats', '[]'::jsonb) then
      raise exception 'Só o administrador altera as funções.';
    end if;
  end loop;
  if exists (select 1 from jsonb_object_keys(coalesce(new.data->'cargos', '{}'::jsonb)) x
             where not coalesce(old.data->'cargos', '{}'::jsonb) ? x) then
    raise exception 'Só o administrador cria funções.';
  end if;
  return new;
end $$;

drop trigger if exists companies_guard on public.companies;
create trigger companies_guard before update on public.companies
  for each row execute function public.guard_company();

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.guard_profile();

-- Nome de usuário livre? (usado no cadastro, antes de existir sessão)
create or replace function public.username_available(uname text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(trim(uname)))
$$;

-- E-mail do nome de usuário, para entrar com "nome de usuário + senha" (o login do Supabase é por e-mail).
create or replace function public.email_for_username(uname text) returns text
language sql stable security definer set search_path = public as $$
  select data->>'email' from public.profiles where username = lower(trim(uname)) limit 1
$$;

-- Assumir uma tarefa aberta para a equipe: só um consegue (linha travada), e só quem atende a categoria.
create or replace function public.claim_task(task_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me text := auth.uid()::text;
  t public.tasks%rowtype;
  p public.profiles%rowtype;
  cargo jsonb;
  cat text;
begin
  if me is null then raise exception 'Faça login.'; end if;
  select * into t from public.tasks where id = task_id for update;
  if t.id is null or t.company is distinct from public.my_company() then raise exception 'Tarefa não encontrada.'; end if;
  if coalesce((t.data->>'pool')::boolean, false) is not true then
    raise exception 'Esta tarefa não está aberta para a equipe.';
  end if;
  if t.emp is not null then raise exception 'Outro funcionário já pegou esta tarefa.'; end if;
  if t.status <> 'aguardando' then raise exception 'Esta tarefa não está aberta para a equipe.'; end if;

  select * into p from public.profiles where id = me and status = 'active';
  cat := t.data->>'cat';
  if p.role = 'func' and cat is not null then
    -- Mesma regra do app (canSeeCategory): sem função definida vê tudo; com função, só as categorias dela.
    select c.data->'cargos'->(p.data->'ws'->>'cargo') into cargo from public.companies c where c.id = t.company;
    if cargo is not null and not coalesce((cargo->'cats') ? cat, false) then
      raise exception 'Esta tarefa não é da sua função.';
    end if;
  elsif p.role is distinct from 'admin' and p.role is distinct from 'func' then
    raise exception 'Só funcionários e o administrador assumem tarefas.';
  end if;

  update public.tasks
     set data = data || jsonb_build_object(
       'emp', me,
       'hist', coalesce(data->'hist', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         't', (extract(epoch from now()) * 1000)::bigint,
         'x', 'Assumida por ' || coalesce(p.data->>'name', '—'))))
   where id = task_id;
end $$;

grant execute on function public.claim_task(text) to authenticated;

-- Excluir a própria conta. Tarefas abertas que a pessoa pediu são canceladas; as que ela executaria
-- voltam a ficar abertas para a equipe. O administrador precisa excluir a empresa antes.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  me text := auth.uid()::text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if me is null then raise exception 'Faça login.'; end if;
  if exists (select 1 from public.companies where admin = me) then
    raise exception 'Você é administrador de uma empresa: exclua a empresa antes de excluir a conta.';
  end if;
  perform set_config('tm.bypass', 'on', true);
  update public.tasks
     set data = data || jsonb_build_object('status', 'cancelada',
       'hist', coalesce(data->'hist', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         't', now_ms, 'x', 'Cancelada: a conta de quem pediu foi excluída')))
   where req = me and status not in ('concluida', 'cancelada');
  update public.tasks
     set data = data || jsonb_build_object('emp', null, 'pool', true, 'status', 'aguardando',
       'start', null, 'cat', data->'devArea',
       'hist', coalesce(data->'hist', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
         't', now_ms, 'x', 'Voltou a ficar aberta para a equipe: a conta do funcionário foi excluída')))
   where emp = me and status not in ('concluida', 'cancelada');
  delete from public.notifs where to_user = me;
  delete from public.invites where data->>'by' = me;
  delete from public.profiles where id = me;
  delete from auth.users where id = auth.uid();
end $$;

-- Excluir a empresa (só o administrador): apaga todos os dados dela; os membros ficam sem empresa.
create or replace function public.delete_company() returns void
language plpgsql security definer set search_path = public as $$
declare
  me text := auth.uid()::text;
  cid text;
begin
  select id into cid from public.companies where admin = me;
  if cid is null then raise exception 'Só o administrador pode excluir a empresa.'; end if;
  perform set_config('tm.bypass', 'on', true);
  delete from public.tasks     where company = cid;
  delete from public.devices   where company = cid;
  delete from public.tutorials where company = cid;
  delete from public.notifs    where company = cid;
  delete from public.invites   where company = cid;
  update public.profiles
     set data = data || jsonb_build_object('company', null, 'status', null, 'role', null)
   where company = cid;
  delete from public.companies where id = cid;
end $$;

grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.delete_company() to authenticated;
revoke execute on function public.delete_my_account() from anon;
revoke execute on function public.delete_company() from anon;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.email_for_username(text) to anon, authenticated;
grant execute on function public.doc_merge(text, text, jsonb) to authenticated;
grant execute on function public.join_with_invite(text) to authenticated;
grant execute on function public.my_company() to authenticated;
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_company_admin(text) to authenticated;
revoke execute on function public.doc_merge(text, text, jsonb) from anon;
revoke execute on function public.join_with_invite(text) from anon;

-- ---------- Segurança por linha (RLS) ----------
alter table public.companies enable row level security;
alter table public.invites   enable row level security;
alter table public.profiles  enable row level security;
alter table public.tasks     enable row level security;
alter table public.devices   enable row level security;
alter table public.notifs    enable row level security;
alter table public.tutorials enable row level security;

do $$
declare r record;
begin
  -- Recria as políticas do zero (script idempotente).
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('companies', 'invites', 'profiles', 'tasks', 'devices', 'notifs', 'tutorials') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Empresas: a lista é pública para quem está logado (para pedir entrada);
-- quem cria vira o administrador; só ele altera.
create policy companies_select on public.companies for select to authenticated using (true);
create policy companies_insert on public.companies for insert to authenticated with check (admin = auth.uid()::text);
-- O admin altera tudo; funcionários alteram categorias/problemas (ver guard_company).
create policy companies_update on public.companies for update to authenticated
  using (admin = auth.uid()::text or (id = public.my_company() and public.my_role() = 'func'))
  with check (id = public.my_company() or admin = auth.uid()::text);

-- Convites: só o administrador da empresa vê, cria e apaga (o uso é pela função join_with_invite).
create policy invites_select on public.invites for select to authenticated using (public.is_company_admin(company));
create policy invites_insert on public.invites for insert to authenticated with check (public.is_company_admin(company));
create policy invites_delete on public.invites for delete to authenticated using (public.is_company_admin(company));

-- Perfis: cada um vê o próprio e os da sua empresa (incluindo pedidos pendentes).
-- Edita o próprio; o administrador edita os da empresa. As transições de empresa/papel/status
-- são validadas pelo gatilho guard_profile.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid()::text or company = public.my_company());
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid()::text);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()::text or public.is_company_admin(company)) with check (true);

-- Tarefas: membros da empresa veem (a agenda mostra horários ocupados); o solicitante cria;
-- só o solicitante e o responsável alteram. Ninguém apaga (histórico).
create policy tasks_select on public.tasks for select to authenticated using (company = public.my_company());
create policy tasks_insert on public.tasks for insert to authenticated
  with check (req = auth.uid()::text and company = public.my_company());
create policy tasks_update on public.tasks for update to authenticated
  using (company = public.my_company() and (emp = auth.uid()::text or req = auth.uid()::text))
  with check (company = public.my_company());

-- Aparelhos: da empresa. Veem todos os membros; cadastram funcionários e o administrador;
-- alteram funcionários/administrador e quem tem tarefa vinculada (status/log da manutenção);
-- apagam quem cadastrou e o administrador.
create policy devices_select on public.devices for select to authenticated using (company = public.my_company());
create policy devices_insert on public.devices for insert to authenticated with check (
  company = public.my_company() and owner = auth.uid()::text and public.my_role() in ('func', 'admin'));
create policy devices_update on public.devices for update to authenticated using (
  company = public.my_company() and (
    public.my_role() in ('func', 'admin')
    or exists (select 1 from public.tasks t where t.dev = devices.id and t.req = auth.uid()::text)))
  with check (company = public.my_company());
create policy devices_delete on public.devices for delete to authenticated using (
  company = public.my_company() and (owner = auth.uid()::text or public.my_role() = 'admin'));

-- Notificações: só o destinatário lê e apaga; membros enviam dentro da própria empresa.
create policy notifs_select on public.notifs for select to authenticated using (to_user = auth.uid()::text);
create policy notifs_insert on public.notifs for insert to authenticated
  with check (to_user is not null and company = public.my_company());
create policy notifs_delete on public.notifs for delete to authenticated using (to_user = auth.uid()::text);

-- Tutoriais: da empresa; todos leem, funcionários e administrador editam.
create policy tutorials_select on public.tutorials for select to authenticated using (company = public.my_company());
create policy tutorials_insert on public.tutorials for insert to authenticated
  with check (company = public.my_company() and public.my_role() in ('func', 'admin'));
create policy tutorials_update on public.tutorials for update to authenticated
  using (company = public.my_company() and public.my_role() in ('func', 'admin'));
create policy tutorials_delete on public.tutorials for delete to authenticated
  using (company = public.my_company() and public.my_role() in ('func', 'admin'));

-- Visitantes não logados não acessam nada.
revoke all on public.companies, public.invites, public.profiles, public.tasks,
              public.devices, public.notifs, public.tutorials from anon;

-- ---------- Tempo real ----------
do $$
declare t text;
begin
  foreach t in array array['companies', 'invites', 'profiles', 'tasks', 'devices', 'notifs', 'tutorials'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Visões para consultas e relatórios (respeitam o RLS) ----------
drop view if exists public.v_tasks;
drop view if exists public.v_devices;

create view public.v_tasks with (security_invoker = true) as
select t.id,
       c.name                                   as empresa,
       t.data->>'title'                         as titulo,
       t.data->>'prio'                          as prioridade,
       t.status,
       (t.data->>'dur')::int                    as duracao_min,
       to_timestamp((t.data->>'start')::bigint / 1000.0)   as inicio,
       to_timestamp((t.data->>'created')::bigint / 1000.0) as criada_em,
       req.name                                 as solicitante,
       emp.name                                 as funcionario,
       t.data->>'devName'                       as aparelho,
       t.data->>'summary'                       as resumo
from public.tasks t
left join public.companies c on c.id = t.company
left join public.profiles req on req.id = t.req
left join public.profiles emp on emp.id = t.emp;

create view public.v_devices with (security_invoker = true) as
select d.id,
       c.name           as empresa,
       d.data->>'name'  as nome,
       d.data->>'area'  as categoria,
       d.data->>'ip'    as ip,
       d.status,
       p.name           as cadastrado_por,
       jsonb_array_length(coalesce(d.data->'log', '[]'::jsonb)) as registros_log
from public.devices d
left join public.companies c on c.id = d.company
left join public.profiles p on p.id = d.owner;

revoke all on public.v_tasks, public.v_devices from anon;
