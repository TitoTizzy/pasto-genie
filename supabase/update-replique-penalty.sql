-- ================================================================
-- PASTO GENIE - Ajout penalite de replique
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

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

update public.configuration_points
set
  bareme = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              bareme,
              '{francais,replique_penalite}',
              coalesce(bareme #> '{francais,replique_penalite}', '0'::jsonb),
              true
            ),
            '{religion,replique_penalite}',
            coalesce(bareme #> '{religion,replique_penalite}', '0'::jsonb),
            true
          ),
          '{culture,replique_penalite}',
          coalesce(bareme #> '{culture,replique_penalite}', '0'::jsonb),
          true
        ),
        '{maths,replique_penalite}',
        coalesce(bareme #> '{maths,replique_penalite}', '0'::jsonb),
        true
      ),
      '{sport,replique_penalite}',
      coalesce(bareme #> '{sport,replique_penalite}', '0'::jsonb),
      true
    ),
    '{eclair,replique_penalite}',
    '0'::jsonb,
    true
  ),
  updated_at = now()
where id = 'bareme';

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
