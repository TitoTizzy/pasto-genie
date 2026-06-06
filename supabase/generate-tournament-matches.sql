-- ================================================================
-- PASTO GENIE - Generation automatique des matchs par poules
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

create or replace function public.is_admin_or_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select role in ('admin', 'superadmin')
      from public.users
      where id = auth.uid()
    ),
    false
  );
$$;

grant execute on function public.is_admin_or_superadmin() to anon, authenticated, service_role;

alter table public.tournois
  add column if not exists format_type text default 'Poules',
  add column if not exists regles jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamptz;

alter table public.equipes
  add column if not exists poule text default 'Poule unique';

create table if not exists public.tournoi_equipes (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  poule text not null default 'Poule unique',
  statut text not null default 'active' check (statut in ('active', 'retiree', 'disqualifiee')),
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (tournoi_id, equipe_id)
);

create table if not exists public.tournoi_joueurs (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  joueur_id uuid not null references public.joueurs(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  statut text not null default 'active' check (statut in ('active', 'suspendu', 'transfere', 'retire')),
  date_debut timestamptz default now(),
  date_fin timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (tournoi_id, joueur_id)
);

create table if not exists public.transferts_joueurs (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  joueur_id uuid not null references public.joueurs(id) on delete cascade,
  ancienne_equipe_id uuid references public.equipes(id) on delete set null,
  nouvelle_equipe_id uuid not null references public.equipes(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

alter table public.tournoi_equipes enable row level security;
alter table public.tournoi_joueurs enable row level security;
alter table public.transferts_joueurs enable row level security;

grant select on public.tournoi_equipes to anon, authenticated;
grant insert, update, delete on public.tournoi_equipes to authenticated;
grant select on public.tournoi_joueurs to anon, authenticated;
grant insert, update, delete on public.tournoi_joueurs to authenticated;
grant select on public.transferts_joueurs to authenticated;
grant insert, update, delete on public.transferts_joueurs to authenticated;

drop policy if exists "tournoi_equipes_public_read" on public.tournoi_equipes;
create policy "tournoi_equipes_public_read" on public.tournoi_equipes for select using (true);
drop policy if exists "tournoi_equipes_admin_write" on public.tournoi_equipes;
create policy "tournoi_equipes_admin_write" on public.tournoi_equipes for all
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

drop policy if exists "tournoi_joueurs_public_read" on public.tournoi_joueurs;
create policy "tournoi_joueurs_public_read" on public.tournoi_joueurs for select using (true);
drop policy if exists "tournoi_joueurs_admin_write" on public.tournoi_joueurs;
create policy "tournoi_joueurs_admin_write" on public.tournoi_joueurs for all
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

drop policy if exists "transferts_admin_read" on public.transferts_joueurs;
create policy "transferts_admin_read" on public.transferts_joueurs for select
using (public.is_admin_or_superadmin());
drop policy if exists "transferts_admin_write" on public.transferts_joueurs;
create policy "transferts_admin_write" on public.transferts_joueurs for all
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

create or replace function public.player_snapshot_for_team(p_equipe_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', j.id,
        'prenom', j.prenom,
        'nom', j.nom,
        'photo_url', j.photo_url,
        'type', 'titulaire'
      )
      order by j.nom, j.prenom
    ),
    '[]'::jsonb
  )
  from public.joueurs j
  where j.equipe_id = p_equipe_id
    and coalesce(j.actif, true) = true;
$$;

create or replace function public.player_snapshot_for_team(p_equipe_id uuid, p_tournoi_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', j.id,
        'prenom', j.prenom,
        'nom', j.nom,
        'photo_url', j.photo_url,
        'type', 'titulaire'
      )
      order by j.nom, j.prenom
    ),
    '[]'::jsonb
  )
  from public.tournoi_joueurs tj
  join public.joueurs j on j.id = tj.joueur_id
  where tj.tournoi_id = p_tournoi_id
    and tj.equipe_id = p_equipe_id
    and tj.statut = 'active';
$$;

create or replace function public.team_snapshot(p_equipe_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'nom', e.nom,
    'paroisse', e.paroisse,
    'embleme_url', e.embleme_url,
    'couleur_primaire', coalesce(e.couleur_primaire, '#38bdf8'),
    'couleur_secondaire', coalesce(e.couleur_secondaire, '#f59e0b'),
    'poule', coalesce(e.poule, 'Poule unique'),
    'titulaires', public.player_snapshot_for_team(e.id),
    'remplacants', '[]'::jsonb
  )
  from public.equipes e
  where e.id = p_equipe_id;
$$;

create or replace function public.team_snapshot(p_equipe_id uuid, p_tournoi_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'nom', e.nom,
    'paroisse', e.paroisse,
    'embleme_url', e.embleme_url,
    'couleur_primaire', coalesce(e.couleur_primaire, '#38bdf8'),
    'couleur_secondaire', coalesce(e.couleur_secondaire, '#f59e0b'),
    'poule', coalesce(te.poule, e.poule, 'Poule unique'),
    'titulaires', public.player_snapshot_for_team(e.id, p_tournoi_id),
    'remplacants', '[]'::jsonb
  )
  from public.equipes e
  left join public.tournoi_equipes te
    on te.equipe_id = e.id
   and te.tournoi_id = p_tournoi_id
  where e.id = p_equipe_id;
$$;

create or replace function public.generer_matchs_competition(
  p_tournoi_id uuid,
  p_start_at timestamptz default null,
  p_interval_minutes int default 60
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournoi public.tournois%rowtype;
  v_match_count int := 0;
  v_slot int := 0;
  r record;
begin
  if not public.is_superadmin() then
    raise exception 'Seul un superadmin peut generer le calendrier';
  end if;

  select * into v_tournoi
  from public.tournois
  where id = p_tournoi_id;

  if not found then
    raise exception 'Competition introuvable';
  end if;

  for r in
    with ranked as (
      select
        e.id,
        coalesce(te.poule, e.poule, 'Poule unique') as poule,
        row_number() over (partition by coalesce(te.poule, e.poule, 'Poule unique') order by e.nom) as rn
      from public.tournoi_equipes te
      join public.equipes e on e.id = te.equipe_id
      where te.tournoi_id = p_tournoi_id
        and te.statut = 'active'
        and coalesce(e.actif, true) = true
    )
    select
      a.id as equipe_a_id,
      b.id as equipe_b_id,
      a.poule
    from ranked a
    join ranked b
      on b.poule = a.poule
     and b.rn > a.rn
    order by a.poule, a.rn, b.rn
  loop
    if not exists (
      select 1
      from public.matches m
      where m.tournoi_id = p_tournoi_id
        and (
          (m.equipe_a_id = r.equipe_a_id and m.equipe_b_id = r.equipe_b_id)
          or
          (m.equipe_a_id = r.equipe_b_id and m.equipe_b_id = r.equipe_a_id)
        )
    ) then
      insert into public.matches (
        equipe_a_id,
        equipe_b_id,
        equipe_a,
        equipe_b,
        categories_ordre,
        categorie_actuelle,
        statut,
        tournoi_id,
        tournament_name,
        scheduled_at,
        created_at,
        updated_at
      )
      values (
        r.equipe_a_id,
        r.equipe_b_id,
        public.team_snapshot(r.equipe_a_id, p_tournoi_id),
        public.team_snapshot(r.equipe_b_id, p_tournoi_id),
        '["francais","religion","culture","maths","sport","eclair"]'::jsonb,
        0,
        'planifie',
        p_tournoi_id,
        v_tournoi.nom,
        case
          when p_start_at is null then null
          else p_start_at + make_interval(mins => greatest(p_interval_minutes, 1) * v_slot)
        end,
        now(),
        now()
      );

      v_match_count := v_match_count + 1;
      v_slot := v_slot + 1;
    end if;
  end loop;

  return v_match_count;
end;
$$;

grant execute on function public.generer_matchs_competition(uuid, timestamptz, int) to authenticated;

notify pgrst, 'reload schema';
