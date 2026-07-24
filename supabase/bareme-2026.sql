-- ================================================================
-- PASTO GENIE 2026 - Nouveau bareme et nouveau calcul de score
-- A coller dans Supabase > SQL Editor > Run
--
-- Ancien modele : 4 valeurs par categorie
--   (bonne, mauvaise, replique, replique_penalite)
--   avec bonne=3, maths=4, eclair=2, replique=1, penalite=0.
--
-- Nouveau modele : UNE valeur de question par phase.
--   bonne reponse    = points
--   mauvaise reponse = 0
--   replique bonne   = +points/2
--   replique mauvaise= -points/2
--
--   5 categories : 10 pts  (replique +/-5)
--   Questions eclair : 50 pts  (replique +/-25)
--   Question bonus   : 100 pts (replique +/-50)
--
-- Les valeurs doivent rester PAIRES : le jeu ne connait pas les
-- demi-points, et la moitie est calculee en division entiere.
-- ================================================================

begin;


-- ================================================================
-- ETAPE 1 - La phase "bonus" doit devenir une categorie valide
-- ================================================================
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.match_evenements'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%categorie%'
  loop
    execute format('alter table public.match_evenements drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.match_evenements
  add constraint match_evenements_categorie_check
  check (categorie in ('francais', 'religion', 'culture', 'maths', 'sport', 'eclair', 'bonus'));


-- ================================================================
-- ETAPE 2 - Le bareme officiel 2026
-- ================================================================
insert into public.configuration_points (id, bareme, updated_at)
values (
  'bareme',
  '{
    "francais": {"points": 10,  "questions": 6},
    "religion": {"points": 10,  "questions": 6},
    "culture":  {"points": 10,  "questions": 6},
    "maths":    {"points": 10,  "questions": 6},
    "sport":    {"points": 10,  "questions": 6},
    "eclair":   {"points": 50,  "questions": 3},
    "bonus":    {"points": 100, "questions": 1}
  }'::jsonb,
  now()
)
on conflict (id) do update
set bareme = excluded.bareme,
    updated_at = now();


-- ================================================================
-- ETAPE 3 - Le calcul des points
--
-- Compatible avec l'ancien format : si une phase porte encore une cle
-- "bonne" au lieu de "points", on la lit quand meme. Ca evite qu'un
-- bareme non migre remette tous les scores a zero en silence.
-- ================================================================
create or replace function public.points_pour_action(
  p_action text,
  p_points_question int
)
returns int
language sql
immutable
as $$
  select case p_action
    when 'bonne_reponse'     then coalesce(p_points_question, 0)
    when 'mauvaise_reponse'  then 0
    when 'replique_bonne'    then  (coalesce(p_points_question, 0) / 2)
    when 'replique_mauvaise' then -(coalesce(p_points_question, 0) / 2)
    else 0
  end;
$$;

grant execute on function public.points_pour_action(text, int) to anon, authenticated, service_role;


create or replace function public.apply_match_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bareme jsonb;
  v_phase jsonb;
  v_points_question int;
  v_points int := 0;
  v_current_player_points int := 0;
  v_current_cat_points int := 0;
begin
  select bareme into v_bareme
  from public.configuration_points
  where id = 'bareme';

  v_phase := coalesce(v_bareme -> new.categorie, '{}'::jsonb);

  -- "points" (nouveau format) sinon "bonne" (ancien format)
  v_points_question := coalesce(
    (v_phase ->> 'points')::int,
    (v_phase ->> 'bonne')::int,
    0
  );

  v_points := public.points_pour_action(new.action, v_points_question);

  if not exists (select 1 from public.match_en_cours where id = new.match_id) then
    insert into public.match_en_cours (id, score_a, score_b, points_joueurs, score_par_categorie, updated_at)
    values (new.match_id, 0, 0, '{}'::jsonb, '{}'::jsonb, now());
  end if;

  if v_points <> 0 then
    select
      coalesce((points_joueurs ->> new.joueur_id)::int, 0),
      coalesce((score_par_categorie -> new.categorie ->> new.equipe)::int, 0)
    into v_current_player_points, v_current_cat_points
    from public.match_en_cours
    where id = new.match_id;

    update public.match_en_cours
    set
      score_a = case when new.equipe = 'A' then coalesce(score_a, 0) + v_points else score_a end,
      score_b = case when new.equipe = 'B' then coalesce(score_b, 0) + v_points else score_b end,
      points_joueurs = jsonb_set(
        coalesce(points_joueurs, '{}'::jsonb),
        array[new.joueur_id],
        to_jsonb(v_current_player_points + v_points),
        true
      ),
      score_par_categorie = jsonb_set(
        coalesce(score_par_categorie, '{}'::jsonb),
        array[new.categorie, new.equipe],
        to_jsonb(v_current_cat_points + v_points),
        true
      ),
      updated_at = now()
    where id = new.match_id;
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


-- ================================================================
-- ETAPE 4 - Recalcul complet d'un match depuis le journal
--
-- Necessaire des qu'un avis de juge est corrige apres coup : le score
-- ne peut plus etre un compteur qu'on incremente, il doit etre rejoue
-- depuis les evenements. Appelable a tout moment sans effet de bord.
-- ================================================================
create or replace function public.recalculer_score_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bareme jsonb;
  v_score_a int := 0;
  v_score_b int := 0;
  v_joueurs jsonb := '{}'::jsonb;
  v_categories jsonb := '{}'::jsonb;
  r record;
  v_points int;
begin
  select bareme into v_bareme from public.configuration_points where id = 'bareme';

  for r in
    select e.joueur_id, e.equipe, e.action, e.categorie
    from public.match_evenements e
    where e.match_id = p_match_id
    order by e.created_at
  loop
    v_points := public.points_pour_action(
      r.action,
      coalesce(
        (v_bareme -> r.categorie ->> 'points')::int,
        (v_bareme -> r.categorie ->> 'bonne')::int,
        0
      )
    );

    if v_points <> 0 then
      if r.equipe = 'A' then
        v_score_a := v_score_a + v_points;
      else
        v_score_b := v_score_b + v_points;
      end if;

      v_joueurs := jsonb_set(
        v_joueurs,
        array[r.joueur_id],
        to_jsonb(coalesce((v_joueurs ->> r.joueur_id)::int, 0) + v_points),
        true
      );

      v_categories := jsonb_set(
        v_categories,
        array[r.categorie, r.equipe],
        to_jsonb(coalesce((v_categories -> r.categorie ->> r.equipe)::int, 0) + v_points),
        true
      );
    end if;
  end loop;

  insert into public.match_en_cours (id, score_a, score_b, points_joueurs, score_par_categorie, updated_at)
  values (p_match_id, v_score_a, v_score_b, v_joueurs, v_categories, now())
  on conflict (id) do update
  set score_a = excluded.score_a,
      score_b = excluded.score_b,
      points_joueurs = excluded.points_joueurs,
      score_par_categorie = excluded.score_par_categorie,
      updated_at = now();
end;
$$;

grant execute on function public.recalculer_score_match(uuid) to authenticated, service_role;


-- ================================================================
-- ETAPE 5 - Rejouer les matchs deja saisis avec le nouveau bareme
-- ================================================================
do $$
declare
  m record;
begin
  for m in select distinct match_id from public.match_evenements loop
    perform public.recalculer_score_match(m.match_id);
  end loop;
end $$;


-- ================================================================
-- ETAPE 6 - Verification
-- ================================================================
select
  key as phase,
  (value ->> 'points')::int as question,
  (value ->> 'points')::int / 2 as replique,
  (value ->> 'questions')::int as nb_questions
from public.configuration_points, jsonb_each(bareme)
where id = 'bareme'
order by (value ->> 'points')::int, key;

-- Attendu : 5 phases a 10 pts (replique 5), eclair 50 (25), bonus 100 (50).
-- Si correct : commit;   sinon : rollback;

notify pgrst, 'reload schema';

commit;
