-- ================================================================
-- PASTO GENIE 2026 - Questions preparees avant le match
-- A coller dans Supabase > SQL Editor > Run
-- A executer APRES 020.
--
-- Le superadmin prepare les questions de chaque match a l'avance et les
-- importe. Pendant la rencontre, le juge lit la question a l'ecran et
-- garde la bonne reponse sur sa feuille papier : son verdict devient
-- objectif, donc UN SEUL juge peut suffire.
--
-- Deux changements :
--   1. nouvelle table questions_match (le jeu de questions du match)
--   2. un juge peut couvrir les DEUX equipes (equipe = 'TOUS'), ce qui
--      autorise un match arbitre par une seule personne. Minimum 1 juge,
--      maximum 4.
-- ================================================================

begin;

-- ================================================================
-- A. Les questions du match
-- ================================================================
create table if not exists public.questions_match (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  categorie text not null check (categorie in (
    'francais', 'culture', 'maths', 'kreyol',
    'religion', 'sport', 'eclair', 'bonus'
  )),
  numero int not null check (numero >= 1),
  -- 'A' ou 'B' quand chaque equipe a sa propre question,
  -- 'TOUS' quand la meme question sert aux deux.
  equipe text not null default 'TOUS' check (equipe in ('A', 'B', 'TOUS')),
  question text not null,
  reponse text,
  created_at timestamptz default now(),
  unique (match_id, categorie, numero, equipe)
);

create index if not exists idx_questions_match
  on public.questions_match (match_id, categorie, numero);

alter table public.questions_match enable row level security;

-- Les questions ne sont JAMAIS lisibles par le public : anon n'a aucun droit.
grant select, insert, update, delete on public.questions_match to authenticated;

drop policy if exists "questions_lecture_officiels" on public.questions_match;
create policy "questions_lecture_officiels" on public.questions_match
for select to authenticated
using (public.is_jury_or_admin());

drop policy if exists "questions_ecriture_admin" on public.questions_match;
create policy "questions_ecriture_admin" on public.questions_match
for all to authenticated
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());


-- ================================================================
-- B. Un juge peut couvrir les deux equipes
-- ================================================================
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.match_juges'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%equipe%'
  loop
    execute format('alter table public.match_juges drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.match_juges
  add constraint match_juges_equipe_check
  check (equipe in ('A', 'B', 'TOUS'));


-- ================================================================
-- C. Comptage des juges requis
--    Un juge marque 'TOUS' compte pour les deux equipes.
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
  delete from public.match_evenements
  where match_id = p_match_id and question_key = p_question_key;

  select a.* into r
  from public.avis_juges a
  where a.match_id = p_match_id and a.question_key = p_question_key
  order by a.updated_at desc, a.created_at desc
  limit 1;

  if r.id is not null then
    -- Un avis de superadmin reste decisif
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
      where match_id = p_match_id
        and (equipe = r.equipe or equipe = 'TOUS');
      if v_requis = 0 then
        v_requis := 1; -- aucun juge assigne : un avis suffit
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

  perform public.recalculer_score_match(p_match_id);
end;
$$;


-- ================================================================
-- D. Meme regle a la soumission d'un avis
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

  select count(*) into v_assignes
  from public.match_juges
  where match_id = p_match_id
    and (equipe = p_equipe or equipe = 'TOUS');

  select exists (
    select 1 from public.match_juges
    where match_id = p_match_id
      and juge_id = auth.uid()
      and (equipe = p_equipe or equipe = 'TOUS')
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
-- E. Realtime
-- ================================================================
do $$
begin
  alter publication supabase_realtime add table public.questions_match;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
