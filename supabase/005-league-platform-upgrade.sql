-- ================================================================
-- PASTO GENIE - Effectifs, historiques figes et classements
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

create extension if not exists pgcrypto;

create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  paroisse text,
  embleme_url text,
  couleur_primaire text default '#38bdf8',
  couleur_secondaire text default '#f59e0b',
  actif boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists public.joueurs (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid references public.equipes(id) on delete set null,
  prenom text,
  nom text,
  photo_url text,
  date_naissance date,
  note text,
  actif boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz
);

alter table public.matches
  add column if not exists equipe_a_id uuid references public.equipes(id),
  add column if not exists equipe_b_id uuid references public.equipes(id);

do $$
begin
  alter table public.matches
    add constraint matches_tournoi_required check (tournoi_id is not null) not valid;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.match_stats_equipes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  equipe_id uuid references public.equipes(id) on delete set null,
  adversaire_id uuid references public.equipes(id) on delete set null,
  cote text not null check (cote in ('A', 'B')),
  score int not null default 0,
  score_adverse int not null default 0,
  gagne boolean not null default false,
  nul boolean not null default false,
  perdu boolean not null default false,
  played_at timestamptz not null default now(),
  created_at timestamptz default now(),
  unique (match_id, cote)
);

create table if not exists public.match_stats_joueurs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  joueur_id uuid references public.joueurs(id) on delete set null,
  equipe_id uuid references public.equipes(id) on delete set null,
  points int not null default 0,
  bonnes int not null default 0,
  mauvaises int not null default 0,
  repliques_bonnes int not null default 0,
  repliques_mauvaises int not null default 0,
  played_at timestamptz not null default now(),
  created_at timestamptz default now(),
  unique (match_id, joueur_id)
);

create or replace function public.finalize_match_stats(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_live public.match_en_cours%rowtype;
  v_played_at timestamptz;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'Match introuvable';
  end if;

  if not public.is_superadmin()
     and not (public.is_jury_or_admin() and v_match.jury_id = auth.uid()) then
    raise exception 'Vous ne pouvez pas valider ce match';
  end if;

  if v_match.tournoi_id is null then
    raise exception 'Un match doit appartenir a un tournoi avant validation finale';
  end if;

  select * into v_live from public.match_en_cours where id = p_match_id;
  if not found then
    raise exception 'Score live introuvable pour ce match';
  end if;

  v_played_at := coalesce(v_match.ended_at, now());

  insert into public.match_stats_equipes (
    match_id, tournoi_id, equipe_id, adversaire_id, cote,
    score, score_adverse, gagne, nul, perdu, played_at
  )
  values
    (
      p_match_id, v_match.tournoi_id, v_match.equipe_a_id, v_match.equipe_b_id, 'A',
      coalesce(v_live.score_a, 0), coalesce(v_live.score_b, 0),
      coalesce(v_live.score_a, 0) > coalesce(v_live.score_b, 0),
      coalesce(v_live.score_a, 0) = coalesce(v_live.score_b, 0),
      coalesce(v_live.score_a, 0) < coalesce(v_live.score_b, 0),
      v_played_at
    ),
    (
      p_match_id, v_match.tournoi_id, v_match.equipe_b_id, v_match.equipe_a_id, 'B',
      coalesce(v_live.score_b, 0), coalesce(v_live.score_a, 0),
      coalesce(v_live.score_b, 0) > coalesce(v_live.score_a, 0),
      coalesce(v_live.score_b, 0) = coalesce(v_live.score_a, 0),
      coalesce(v_live.score_b, 0) < coalesce(v_live.score_a, 0),
      v_played_at
    )
  on conflict (match_id, cote) do update
  set
    tournoi_id = excluded.tournoi_id,
    equipe_id = excluded.equipe_id,
    adversaire_id = excluded.adversaire_id,
    score = excluded.score,
    score_adverse = excluded.score_adverse,
    gagne = excluded.gagne,
    nul = excluded.nul,
    perdu = excluded.perdu,
    played_at = excluded.played_at;

  insert into public.match_stats_joueurs (
    match_id, tournoi_id, joueur_id, equipe_id, points,
    bonnes, mauvaises, repliques_bonnes, repliques_mauvaises, played_at
  )
  select
    p_match_id,
    v_match.tournoi_id,
    e.joueur_id::uuid,
    case
      when e.equipe = 'A' then v_match.equipe_a_id
      else v_match.equipe_b_id
    end,
    coalesce((v_live.points_joueurs ->> e.joueur_id)::int, 0),
    count(*) filter (where e.action = 'bonne_reponse')::int,
    count(*) filter (where e.action = 'mauvaise_reponse')::int,
    count(*) filter (where e.action = 'replique_bonne')::int,
    count(*) filter (where e.action = 'replique_mauvaise')::int,
    v_played_at
  from public.match_evenements e
  where e.match_id = p_match_id
    and e.joueur_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by e.joueur_id, e.equipe
  on conflict (match_id, joueur_id) do update
  set
    tournoi_id = excluded.tournoi_id,
    equipe_id = excluded.equipe_id,
    points = excluded.points,
    bonnes = excluded.bonnes,
    mauvaises = excluded.mauvaises,
    repliques_bonnes = excluded.repliques_bonnes,
    repliques_mauvaises = excluded.repliques_mauvaises,
    played_at = excluded.played_at;

  update public.matches
  set statut = 'termine', ended_at = v_played_at, updated_at = now()
  where id = p_match_id;
end;
$$;

create or replace view public.v_classement_equipes as
select
  s.equipe_id,
  e.nom,
  e.paroisse,
  e.embleme_url,
  e.couleur_primaire,
  count(*)::int as matchs,
  sum(case when s.gagne then 1 else 0 end)::int as victoires,
  sum(case when s.nul then 1 else 0 end)::int as nuls,
  sum(case when s.perdu then 1 else 0 end)::int as defaites,
  sum(s.score)::int as points_marques,
  sum(s.score_adverse)::int as points_encaisses,
  sum(case when s.gagne then 3 when s.nul then 1 else 0 end)::int as points_classement
from public.match_stats_equipes s
left join public.equipes e on e.id = s.equipe_id
group by s.equipe_id, e.nom, e.paroisse, e.embleme_url, e.couleur_primaire;

create or replace view public.v_classement_joueurs as
select
  s.joueur_id,
  j.prenom,
  j.nom,
  j.photo_url,
  s.equipe_id,
  e.nom as equipe_nom,
  count(*)::int as matchs,
  sum(s.points)::int as points,
  sum(s.bonnes)::int as bonnes,
  sum(s.mauvaises)::int as mauvaises,
  sum(s.repliques_bonnes)::int as repliques_bonnes,
  sum(s.repliques_mauvaises)::int as repliques_mauvaises
from public.match_stats_joueurs s
left join public.joueurs j on j.id = s.joueur_id
left join public.equipes e on e.id = s.equipe_id
group by s.joueur_id, j.prenom, j.nom, j.photo_url, s.equipe_id, e.nom;

alter table public.equipes enable row level security;
alter table public.joueurs enable row level security;
alter table public.match_stats_equipes enable row level security;
alter table public.match_stats_joueurs enable row level security;

grant select on public.equipes to anon, authenticated;
grant insert, update, delete on public.equipes to authenticated;
grant select on public.joueurs to anon, authenticated;
grant insert, update, delete on public.joueurs to authenticated;
grant select on public.match_stats_equipes to anon, authenticated;
grant insert, update, delete on public.match_stats_equipes to authenticated;
grant select on public.match_stats_joueurs to anon, authenticated;
grant insert, update, delete on public.match_stats_joueurs to authenticated;
grant select on public.v_classement_equipes to anon, authenticated;
grant select on public.v_classement_joueurs to anon, authenticated;
grant execute on function public.finalize_match_stats(uuid) to authenticated;

drop policy if exists "equipes_public_read" on public.equipes;
create policy "equipes_public_read" on public.equipes for select using (true);

drop policy if exists "equipes_admin_write" on public.equipes;
create policy "equipes_admin_write" on public.equipes for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "joueurs_public_read" on public.joueurs;
create policy "joueurs_public_read" on public.joueurs for select using (true);

drop policy if exists "joueurs_admin_write" on public.joueurs;
create policy "joueurs_admin_write" on public.joueurs for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "stats_equipes_public_read" on public.match_stats_equipes;
create policy "stats_equipes_public_read" on public.match_stats_equipes for select using (true);

drop policy if exists "stats_equipes_admin_write" on public.match_stats_equipes;
create policy "stats_equipes_admin_write" on public.match_stats_equipes for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "stats_joueurs_public_read" on public.match_stats_joueurs;
create policy "stats_joueurs_public_read" on public.match_stats_joueurs for select using (true);

drop policy if exists "stats_joueurs_admin_write" on public.match_stats_joueurs;
create policy "stats_joueurs_admin_write" on public.match_stats_joueurs for all
using (public.is_superadmin())
with check (public.is_superadmin());
