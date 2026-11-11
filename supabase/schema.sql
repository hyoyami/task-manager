-- ============================================================================
-- TASK MANAGER — esquema do banco (Supabase / PostgreSQL)
--
-- Cada coleção do app vira uma tabela com:
--   id    text   — o mesmo id usado no app
--   data  jsonb  — o documento inteiro (mesmo formato descrito no CLAUDE.md)
--   colunas geradas a partir do jsonb (emp, req, owner…) para consultas, índices e permissões.
--
-- O login é o Supabase Auth: profiles.id = auth.uid().
-- Segurança por linha (RLS): só usuários autenticados acessam; cada tabela tem suas regras.
-- Script idempotente: pode ser executado de novo sem perder dados.
-- ============================================================================

-- ---------- Tabelas ----------
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
  owner      text generated always as (data->>'owner') stored,
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

create index if not exists tasks_emp_idx     on public.tasks (emp);
create index if not exists tasks_req_idx     on public.tasks (req);
create index if not exists tasks_dev_idx     on public.tasks (dev);
create index if not exists devices_owner_idx on public.devices (owner);
create index if not exists notifs_to_idx     on public.notifs (to_user);

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
  foreach t in array array['profiles', 'tasks', 'devices', 'notifs', 'tutorials'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------- Funções auxiliares ----------
-- Papel ('func' | 'sol') do usuário logado.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()::text
$$;

-- Mescla `patch` no documento (equivale ao update() do app). Respeita o RLS (security invoker).
create or replace function public.doc_merge(tbl text, doc_id text, patch jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if tbl not in ('profiles', 'tasks', 'devices', 'notifs', 'tutorials') then
    raise exception 'Coleção inválida: %', tbl;
  end if;
  execute format('update public.%I set data = data || $1 where id = $2', tbl) using patch, doc_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Documento não existe ou sem permissão: %/%', tbl, doc_id;
  end if;
end $$;

grant execute on function public.doc_merge(text, text, jsonb) to authenticated;
grant execute on function public.my_role() to authenticated;
revoke execute on function public.doc_merge(text, text, jsonb) from anon;

-- ---------- Segurança por linha (RLS) ----------
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
           where schemaname = 'public' and tablename in ('profiles', 'tasks', 'devices', 'notifs', 'tutorials') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Perfis: todos os usuários logados veem (equipe, nomes); cada um só cria/edita o próprio.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid()::text);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()::text) with check (id = auth.uid()::text);

-- Tarefas: todos veem (a agenda mostra os horários ocupados); o solicitante cria;
-- só o solicitante e o responsável alteram. Ninguém apaga (histórico).
create policy tasks_select on public.tasks for select to authenticated using (true);
create policy tasks_insert on public.tasks for insert to authenticated with check (req = auth.uid()::text);
create policy tasks_update on public.tasks for update to authenticated
  using (emp = auth.uid()::text or req = auth.uid()::text);

-- Aparelhos: todos veem; o dono cria/apaga; alteram o dono e quem tem tarefa vinculada
-- ao aparelho (abrir/encerrar manutenção muda o status e o log).
create policy devices_select on public.devices for select to authenticated using (true);
create policy devices_insert on public.devices for insert to authenticated with check (owner = auth.uid()::text);
create policy devices_delete on public.devices for delete to authenticated using (owner = auth.uid()::text);
create policy devices_update on public.devices for update to authenticated using (
  owner = auth.uid()::text
  or exists (select 1 from public.tasks t
             where t.dev = devices.id and (t.req = auth.uid()::text or t.emp = auth.uid()::text))
);

-- Notificações: só o destinatário lê e apaga; qualquer usuário logado envia.
create policy notifs_select on public.notifs for select to authenticated using (to_user = auth.uid()::text);
create policy notifs_insert on public.notifs for insert to authenticated with check (to_user is not null);
create policy notifs_delete on public.notifs for delete to authenticated using (to_user = auth.uid()::text);

-- Tutoriais: todos leem; só funcionários criam, editam e apagam.
create policy tutorials_select on public.tutorials for select to authenticated using (true);
create policy tutorials_insert on public.tutorials for insert to authenticated with check (public.my_role() = 'func');
create policy tutorials_update on public.tutorials for update to authenticated using (public.my_role() = 'func');
create policy tutorials_delete on public.tutorials for delete to authenticated using (public.my_role() = 'func');

-- Visitantes não logados não acessam nada.
revoke all on public.profiles, public.tasks, public.devices, public.notifs, public.tutorials from anon;

-- ---------- Tempo real ----------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'tasks', 'devices', 'notifs', 'tutorials'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Visões para consultas e relatórios (respeitam o RLS) ----------
create or replace view public.v_tasks with (security_invoker = true) as
select t.id,
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
left join public.profiles req on req.id = t.req
left join public.profiles emp on emp.id = t.emp;

create or replace view public.v_devices with (security_invoker = true) as
select d.id,
       d.data->>'name'  as nome,
       d.data->>'area'  as categoria,
       d.data->>'ip'    as ip,
       d.status,
       p.name           as responsavel,
       jsonb_array_length(coalesce(d.data->'log', '[]'::jsonb)) as registros_log
from public.devices d
left join public.profiles p on p.id = d.owner;

revoke all on public.v_tasks, public.v_devices from anon;
