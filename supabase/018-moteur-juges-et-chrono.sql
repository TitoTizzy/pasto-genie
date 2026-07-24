-- ================================================================
-- PASTO GENIE 2026 - Moteur de juges, validation a deux, chrono
-- A coller dans Supabase > SQL Editor > Run
-- A executer APRES 015, 016 et 017.
--
-- Regles implementees (interview du 23 juillet 2026) :
--  - 4 juges par match, 2 par equipe (table match_juges)
--  - un point n'existe que si TOUS les juges assignes a l'equipe
--    donnent le meme avis ; sans juges assignes, un seul avis suffit
--    (mode simple, filet de securite)
--  - l'avis d'un superadmin est toujours decisif
--  - un juge peut corriger son avis a tout moment : le score est
--    rejoue depuis le journal, jamais simplement incremente
--  - chrono de reponse pilote a la main par le superadmin
-- ================================================================

begin;

-- ================================================================
-- A. Colonnes de pilotage sur les matchs
-- ================================================================
alter table public.matches
  add column if not exists question_num int not null default 1,
  add column if not exists chrono jsonb;

alter table public.match_evenements
  add column if not exists question_key text;

create index if not exists idx_evenements_question
  on public.match_evenements (match_id, question_key);

-- La phase bonus entre dans l'ordre des phases des matchs non termines
update public.matches
set categories_ordre = categories_ordre || '["bonus"]'::jsonb
where statut <> 'termine'
  and not (categories_ordre @> '["bonus"]'::jsonb);

-- ================================================================
-- B. Les juges d'un match (2 par equipe)
-- ================================================================
create table if not exists public.match_juges (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  juge_id uuid not null references public.users(id) on delete cascade,
  equipe text not null check (equipe in ('A', 'B')),
  created_at timestamptz default now(),
  unique (match_id, juge_id)
);

alter table public.match_juges enable row level security;
grant select on public.match_juges to authenticated;
grant insert, update, delete on public.match_juges to authenticated;

drop policy if exists "match_juges_read" on public.match_juges;
create policy "match_juges_read" on public.match_juges
for select to authenticated using (true);

drop policy if exists "match_juges_admin_write" on public.match_juges;
create policy "match_juges_admin_write" on public.match_juges
for all to authenticated
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

-- ================================================================
-- C. Les avis des juges
--    question_key : ex. "francais-q3" ; replique : "francais-q3-r"
-- ================================================================
create table if not exists public.avis_juges (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  question_key text not null,
  juge_id uuid not null references public.users(id) on delete cascade,
  equipe text not null check (equipe in ('A', 'B')),
  joueur_id text not null,
  joueur_nom text,
  categorie text not null,
  action text not null check (action in ('bonne_reponse', 'mauvaise_reponse', 'replique_bonne', 'replique_mauvaise')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (match_id, question_key, juge_id)
);

create index if not exists idx_avis_question on public.avis_juges (match_id, question_key);

alter table public.avis_juges enable row level security;
grant select on public.avis_juges to authenticated;

drop policy if exists "avis_read" on public.avis_juges;
create policy "avis_read" on public.avis_juges
for select to authenticated using (true);
-- Pas de policy d'ecriture : tout passe par soumettre_avis / annuler_avis.

-- ================================================================
-- D. Synchronisation avis -> evenement officiel
--    A chaque avis pose, modifie ou retire : on refait le point.
-- ================================================================
create or replace function public.synchroniser_question(p_match_id uuid, p_question_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_requis int;
  v_recus int;
  v_distinct int;
  v_admin record;
begin
  -- Toujours repartir de zero pour cette question
  delete from public.match_evenements
  where match_id = p_match_id and question_key = p_question_key;

  -- L'avis le plus recent porte les details (joueur, action, equipe)
  select a.* into r
  from public.avis_juges a
  where a.match_id = p_match_id and a.question_key = p_question_key
  order by a.updated_at desc, a.created_at desc
  limit 1;

  if r.id is not null then
    -- Un avis de superadmin est toujours decisif
    select a.* into v_admin
    from public.avis_juges a
    join public.users u on u.id = a.juge_id
    where a.match_id = p_match_id and a.question_key = p_question_key
      and u.role = 'superadmin'
    order by a.updated_at desc
    limit 1;

    if v_admin.id is not null then
      r := v_admin;
      v_requis := 1;
      v_recus := 1;
      v_distinct := 1;
    else
      select count(*) into v_requis
      from public.match_juges
      where match_id = p_match_id and equipe = r.equipe;
      if v_requis = 0 then
        v_requis := 1; -- mode simple : aucun juge assigne, un avis suffit
      end if;

      select count(*), count(distinct action) into v_recus, v_distinct
      from public.avis_juges
      where match_id = p_match_id and question_key = p_question_key;
    end if;

    if v_recus >= v_requis and v_distinct = 1 then
      insert into public.match_evenements
        (match_id, joueur_id, joueur_nom, equipe, action, categorie, jury_id, question_key)
      values
        (p_match_id, r.joueur_id, r.joueur_nom, r.equipe, r.action, r.categorie, r.juge_id, p_question_key);
    end if;
  end if;

  -- Le score officiel est TOUJOURS rejoue depuis le journal
  perform public.recalculer_score_match(p_match_id);
end;
$$;

create or replace function public.trg_sync_avis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.synchroniser_question(
    coalesce(new.match_id, old.match_id),
    coalesce(new.question_key, old.question_key)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_avis_sync on public.avis_juges;
create trigger trg_avis_sync
after insert or update or delete on public.avis_juges
for each row execute function public.trg_sync_avis();

-- ================================================================
-- E. Soumettre un avis (seule porte d'entree des juges)
-- ================================================================
create or replace function public.soumettre_avis(
  p_match_id uuid,
  p_question_key text,
  p_equipe text,
  p_joueur_id text,
  p_joueur_nom text,
  p_categorie text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_assignes int;
  v_est_assigne boolean;
  v_requis int;
  v_recus int;
  v_distinct int;
  v_valide boolean;
begin
  if not public.is_jury_or_admin() then
    raise exception 'Reserve aux juges et administrateurs';
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    raise exception 'Match introuvable';
  end if;
  if v_match.statut <> 'en_cours' then
    raise exception 'Le match n''est pas en cours';
  end if;

  -- Si des juges sont assignes a cette equipe, seuls eux (et les admins)
  -- peuvent se prononcer sur ses reponses.
  select count(*) into v_assignes
  from public.match_juges
  where match_id = p_match_id and equipe = p_equipe;

  select exists (
    select 1 from public.match_juges
    where match_id = p_match_id and equipe = p_equipe and juge_id = auth.uid()
  ) into v_est_assigne;

  if v_assignes > 0 and not v_est_assigne and not public.is_admin_or_superadmin() then
    raise exception 'Vous n''etes pas juge de cette equipe pour ce match';
  end if;

  insert into public.avis_juges
    (match_id, question_key, juge_id, equipe, joueur_id, joueur_nom, categorie, action, updated_at)
  values
    (p_match_id, p_question_key, auth.uid(), p_equipe, p_joueur_id, p_joueur_nom, p_categorie, p_action, now())
  on conflict (match_id, question_key, juge_id) do update
  set equipe = excluded.equipe,
      joueur_id = excluded.joueur_id,
      joueur_nom = excluded.joueur_nom,
      categorie = excluded.categorie,
      action = excluded.action,
      updated_at = now();

  -- Etat apres synchronisation (le trigger a deja tourne)
  select exists (
    select 1 from public.match_evenements
    where match_id = p_match_id and question_key = p_question_key
  ) into v_valide;

  select count(*), count(distinct action) into v_recus, v_distinct
  from public.avis_juges
  where match_id = p_match_id and question_key = p_question_key;

  v_requis := greatest(v_assignes, 1);

  return jsonb_build_object(
    'statut', case
      when v_valide then 'valide'
      when v_distinct > 1 then 'desaccord'
      else 'en_attente'
    end,
    'recus', v_recus,
    'requis', v_requis
  );
end;
$$;

grant execute on function public.soumettre_avis(uuid, text, text, text, text, text, text) to authenticated;

-- ================================================================
-- F. Annuler un avis
-- ================================================================
create or replace function public.annuler_avis(p_match_id uuid, p_question_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_jury_or_admin() then
    raise exception 'Reserve aux juges et administrateurs';
  end if;

  if public.is_superadmin() then
    delete from public.avis_juges
    where match_id = p_match_id and question_key = p_question_key;
  else
    delete from public.avis_juges
    where match_id = p_match_id and question_key = p_question_key and juge_id = auth.uid();
  end if;

  -- Si plus aucun avis : le trigger delete a deja resynchronise.
  -- Ce perform couvre le cas "aucune ligne supprimee".
  perform public.synchroniser_question(p_match_id, p_question_key);
end;
$$;

grant execute on function public.annuler_avis(uuid, text) to authenticated;

-- ================================================================
-- G. Composer les 3 joueurs en lice d'une equipe
-- ================================================================
create or replace function public.definir_titulaires(
  p_match_id uuid,
  p_equipe text,
  p_titulaires jsonb,
  p_remplacants jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_jury_or_admin() then
    raise exception 'Reserve aux juges et administrateurs';
  end if;
  if p_equipe not in ('A', 'B') then
    raise exception 'Equipe invalide';
  end if;

  if p_equipe = 'A' then
    update public.matches
    set equipe_a = jsonb_set(jsonb_set(coalesce(equipe_a, '{}'::jsonb), '{titulaires}', coalesce(p_titulaires, '[]'::jsonb)), '{remplacants}', coalesce(p_remplacants, '[]'::jsonb)),
        updated_at = now()
    where id = p_match_id;
  else
    update public.matches
    set equipe_b = jsonb_set(jsonb_set(coalesce(equipe_b, '{}'::jsonb), '{titulaires}', coalesce(p_titulaires, '[]'::jsonb)), '{remplacants}', coalesce(p_remplacants, '[]'::jsonb)),
        updated_at = now()
    where id = p_match_id;
  end if;
end;
$$;

grant execute on function public.definir_titulaires(uuid, text, jsonb, jsonb) to authenticated;

-- ================================================================
-- H. Chrono de reponse (pilote par le superadmin/admin)
--    p_secondes = null pour arreter.
-- ================================================================
create or replace function public.regler_chrono(p_match_id uuid, p_secondes int default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_or_superadmin() then
    raise exception 'Reserve aux administrateurs';
  end if;

  update public.matches
  set chrono = case
        when p_secondes is null then null
        else jsonb_build_object(
          'duree', p_secondes,
          'fin', to_jsonb(now() + make_interval(secs => p_secondes))
        )
      end,
      updated_at = now()
  where id = p_match_id;
end;
$$;

grant execute on function public.regler_chrono(uuid, int) to authenticated;

-- ================================================================
-- I. Realtime
-- ================================================================
do $$
begin
  alter publication supabase_realtime add table public.avis_juges;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.match_juges;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
