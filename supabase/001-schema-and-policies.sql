-- ================================================================
-- PASTO GENIE - Schema Supabase + RLS + calcul score
-- A coller dans Supabase > SQL Editor > New query > Run
-- ================================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'public' check (role in ('public', 'membre', 'jury', 'superadmin')),
  created_at timestamptz default now()
);

create table if not exists public.tournois (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  annee int,
  description text,
  actif boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  equipe_a jsonb not null,
  equipe_b jsonb not null,
  categories_ordre jsonb not null,
  categorie_actuelle int default 0,
  statut text not null default 'planifie' check (statut in ('planifie', 'en_cours', 'pause', 'termine')),
  tournoi_id uuid,
  tournament_name text,
  jury_id uuid references public.users(id),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists public.match_en_cours (
  id uuid primary key references public.matches(id) on delete cascade,
  score_a int default 0,
  score_b int default 0,
  points_joueurs jsonb default '{}'::jsonb,
  score_par_categorie jsonb default '{}'::jsonb,
  updated_at timestamptz
);

create table if not exists public.match_evenements (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  joueur_id text not null,
  joueur_nom text,
  equipe text not null check (equipe in ('A', 'B')),
  action text not null check (action in ('bonne_reponse', 'mauvaise_reponse', 'replique_bonne', 'replique_mauvaise')),
  categorie text not null check (categorie in ('francais', 'religion', 'culture', 'maths', 'sport', 'eclair')),
  jury_id uuid not null references public.users(id),
  created_at timestamptz default now()
);

create table if not exists public.configuration_points (
  id text primary key,
  bareme jsonb not null,
  updated_at timestamptz
);

create table if not exists public.regles_jeu (
  id text primary key,
  texte text not null,
  updated_at timestamptz
);

create table if not exists public.logs_match (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  event_id uuid,
  payload jsonb,
  created_at timestamptz default now()
);

-- ---------- Helpers roles ----------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.users where id = auth.uid()), 'public');
$$;

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'superadmin';
$$;

create or replace function public.is_jury_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('jury', 'superadmin');
$$;

-- ---------- Donnees initiales ----------
insert into public.configuration_points (id, bareme, updated_at)
values (
  'bareme',
  '{
    "francais": {"bonne": 3, "mauvaise": 0, "replique": 1, "replique_penalite": 0},
    "religion": {"bonne": 3, "mauvaise": 0, "replique": 1, "replique_penalite": 0},
    "culture": {"bonne": 3, "mauvaise": 0, "replique": 1, "replique_penalite": 0},
    "maths": {"bonne": 4, "mauvaise": 0, "replique": 2, "replique_penalite": 0},
    "sport": {"bonne": 3, "mauvaise": 0, "replique": 1, "replique_penalite": 0},
    "eclair": {"bonne": 2, "mauvaise": 0, "replique": 0, "replique_penalite": 0}
  }'::jsonb,
  now()
)
on conflict (id) do nothing;

-- ---------- Calcul score ----------
create or replace function public.apply_match_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bareme jsonb;
  v_points int := 0;
  v_score_field text;
  v_current_player_points int := 0;
  v_current_cat_points int := 0;
begin
  select bareme into v_bareme
  from public.configuration_points
  where id = 'bareme';

  if v_bareme is null then
    v_bareme := '{}'::jsonb;
  end if;

  if new.action = 'bonne_reponse' then
    v_points := coalesce((v_bareme -> new.categorie ->> 'bonne')::int, 0);
  elsif new.action = 'mauvaise_reponse' then
    v_points := coalesce((v_bareme -> new.categorie ->> 'mauvaise')::int, 0);
  elsif new.action = 'replique_bonne' then
    v_points := coalesce((v_bareme -> new.categorie ->> 'replique')::int, 0);
  elsif new.action = 'replique_mauvaise' then
    v_points := -coalesce((v_bareme -> new.categorie ->> 'replique_penalite')::int, 0);
  else
    v_points := 0;
  end if;

  if not exists (select 1 from public.match_en_cours where id = new.match_id) then
    insert into public.match_en_cours (id, score_a, score_b, points_joueurs, score_par_categorie, updated_at)
    values (new.match_id, 0, 0, '{}'::jsonb, '{}'::jsonb, now());
  end if;

  if v_points <> 0 then
    select coalesce((points_joueurs ->> new.joueur_id)::int, 0)
    into v_current_player_points
    from public.match_en_cours
    where id = new.match_id;

    select coalesce((score_par_categorie -> new.categorie ->> new.equipe)::int, 0)
    into v_current_cat_points
    from public.match_en_cours
    where id = new.match_id;

    v_score_field := case when new.equipe = 'A' then 'score_a' else 'score_b' end;

    if v_score_field = 'score_a' then
      update public.match_en_cours
      set
        score_a = coalesce(score_a, 0) + v_points,
        points_joueurs = jsonb_set(coalesce(points_joueurs, '{}'::jsonb), array[new.joueur_id], to_jsonb(v_current_player_points + v_points), true),
        score_par_categorie = jsonb_set(coalesce(score_par_categorie, '{}'::jsonb), array[new.categorie, new.equipe], to_jsonb(v_current_cat_points + v_points), true),
        updated_at = now()
      where id = new.match_id;
    else
      update public.match_en_cours
      set
        score_b = coalesce(score_b, 0) + v_points,
        points_joueurs = jsonb_set(coalesce(points_joueurs, '{}'::jsonb), array[new.joueur_id], to_jsonb(v_current_player_points + v_points), true),
        score_par_categorie = jsonb_set(coalesce(score_par_categorie, '{}'::jsonb), array[new.categorie, new.equipe], to_jsonb(v_current_cat_points + v_points), true),
        updated_at = now()
      where id = new.match_id;
    end if;
  end if;

  insert into public.logs_match (match_id, event_id, payload)
  values (new.match_id, new.id, to_jsonb(new));

  return new;
end;
$$;

drop trigger if exists trg_apply_match_event on public.match_evenements;
create trigger trg_apply_match_event
after insert on public.match_evenements
for each row execute function public.apply_match_event();

-- ---------- RLS ----------
alter table public.users enable row level security;
alter table public.tournois enable row level security;
alter table public.matches enable row level security;
alter table public.match_en_cours enable row level security;
alter table public.match_evenements enable row level security;
alter table public.configuration_points enable row level security;
alter table public.regles_jeu enable row level security;
alter table public.logs_match enable row level security;

-- ---------- Grants API ----------
grant usage on schema public to anon, authenticated;
grant execute on function public.current_user_role() to anon, authenticated;
grant execute on function public.is_superadmin() to anon, authenticated;
grant execute on function public.is_jury_or_admin() to anon, authenticated;

grant select on public.users to authenticated;
grant insert, update, delete on public.users to authenticated;

grant select on public.tournois to anon, authenticated;
grant insert, update, delete on public.tournois to authenticated;

grant select on public.matches to anon, authenticated;
grant insert, update, delete on public.matches to authenticated;

grant select on public.match_en_cours to anon, authenticated;
grant insert, update, delete on public.match_en_cours to authenticated;

grant select on public.match_evenements to anon, authenticated;
grant insert, delete on public.match_evenements to authenticated;

grant select on public.configuration_points to anon, authenticated;
grant insert, update, delete on public.configuration_points to authenticated;

grant select on public.regles_jeu to anon, authenticated;
grant insert, update, delete on public.regles_jeu to authenticated;

grant select on public.logs_match to authenticated;

drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin"
on public.users for select
using (id = auth.uid() or public.is_superadmin());

drop policy if exists "users_admin_all" on public.users;
create policy "users_admin_all"
on public.users for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "tournois_public_read" on public.tournois;
create policy "tournois_public_read"
on public.tournois for select
using (true);

drop policy if exists "tournois_admin_write" on public.tournois;
create policy "tournois_admin_write"
on public.tournois for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "matches_public_read" on public.matches;
create policy "matches_public_read"
on public.matches for select
using (true);

drop policy if exists "matches_admin_write" on public.matches;
create policy "matches_admin_write"
on public.matches for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "matches_assigned_jury_update" on public.matches;
create policy "matches_assigned_jury_update"
on public.matches for update
using (
  public.is_jury_or_admin()
  and (jury_id = auth.uid() or public.is_superadmin())
)
with check (
  public.is_jury_or_admin()
  and (jury_id = auth.uid() or public.is_superadmin())
);

drop policy if exists "live_public_read" on public.match_en_cours;
create policy "live_public_read"
on public.match_en_cours for select
using (true);

drop policy if exists "live_admin_write" on public.match_en_cours;
create policy "live_admin_write"
on public.match_en_cours for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "events_public_read" on public.match_evenements;
create policy "events_public_read"
on public.match_evenements for select
using (true);

drop policy if exists "events_assigned_jury_insert" on public.match_evenements;
create policy "events_assigned_jury_insert"
on public.match_evenements for insert
with check (
  public.is_jury_or_admin()
  and jury_id = auth.uid()
  and exists (
    select 1
    from public.matches m
    where m.id = match_id
      and m.statut = 'en_cours'
      and (m.jury_id = auth.uid() or public.is_superadmin())
  )
);

drop policy if exists "events_admin_delete" on public.match_evenements;
create policy "events_admin_delete"
on public.match_evenements for delete
using (public.is_superadmin());

drop policy if exists "config_public_read" on public.configuration_points;
create policy "config_public_read"
on public.configuration_points for select
using (true);

drop policy if exists "config_admin_write" on public.configuration_points;
create policy "config_admin_write"
on public.configuration_points for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "rules_public_read" on public.regles_jeu;
create policy "rules_public_read"
on public.regles_jeu for select
using (true);

drop policy if exists "rules_admin_write" on public.regles_jeu;
create policy "rules_admin_write"
on public.regles_jeu for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "logs_admin_read" on public.logs_match;
create policy "logs_admin_read"
on public.logs_match for select
using (public.is_superadmin());

-- ---------- Realtime ----------
do $$
begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.match_en_cours;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.match_evenements;
exception when duplicate_object then null;
end $$;
