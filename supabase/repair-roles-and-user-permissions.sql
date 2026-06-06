-- ================================================================
-- PASTO GENIE - Profils officiels + permissions utilisateurs
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

alter table public.users
  add column if not exists permissions jsonb not null default '{}'::jsonb;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.users drop constraint if exists %I', c.conname);
  end loop;
end $$;

update public.users
set role = 'jury'
where role in ('public', 'membre') or role is null;

alter table public.users
  add constraint users_role_official_profiles
  check (role in ('superadmin', 'admin', 'jury'));

update public.users
set permissions = case role
  when 'superadmin' then '{
    "manage_tournaments": true,
    "manage_teams": true,
    "manage_matches": true,
    "score_matches": true,
    "manage_blog": true,
    "manage_rules": true,
    "view_stats": true,
    "manage_users": true
  }'::jsonb
  when 'admin' then '{
    "manage_tournaments": true,
    "manage_teams": true,
    "manage_matches": true,
    "score_matches": false,
    "manage_blog": true,
    "manage_rules": false,
    "view_stats": true,
    "manage_users": false
  }'::jsonb
  else '{
    "manage_tournaments": false,
    "manage_teams": false,
    "manage_matches": false,
    "score_matches": true,
    "manage_blog": false,
    "manage_rules": false,
    "view_stats": true,
    "manage_users": false
  }'::jsonb
end
where permissions = '{}'::jsonb or permissions is null;

grant select, insert, update, delete on public.users to authenticated;
grant all privileges on public.users to service_role;

create or replace function public.is_jury_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('jury', 'admin', 'superadmin');
$$;

grant execute on function public.is_jury_or_admin() to anon, authenticated, service_role;
