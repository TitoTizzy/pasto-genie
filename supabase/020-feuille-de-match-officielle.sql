-- ================================================================
-- PASTO GENIE 2026 - Bareme de la Feuille de Match officielle
-- A coller dans Supabase > SQL Editor > Run
-- A executer APRES 019.
--
-- Source : "FEUILLE DE MATCH 2026" (document officiel PASTO GENIE PM).
--
--   FRANCAIS      10 pts  replique /5    6 questions   -> /60  /30
--   CULTURE GNLE  10 pts  replique /5    6 questions   -> /60  /30
--   MATHS         10 pts  replique /5    6 questions   -> /60  /30
--   KREYOL        10 pts  replique /5    6 questions   -> /60  /30
--   RELIGION      10 pts  replique /5    6 questions   -> /60  /30
--   SPORTS        10 pts  replique /5    6 questions   -> /60  /30
--   ECLAIRES      50 pts  replique /25   3 questions   -> /150 /75
--   QUESTION BONUS 100 pts replique /50  1 question    -> /100 /50
--
--   GRAND TOTAL par equipe : 6 x 90 + 225 + 150 = 915
--
-- Deux corrections par rapport a ce qui tournait :
--   1. KREYOL n'existait pas du tout dans la plateforme.
--   2. L'ordre des phases suit desormais la feuille papier.
-- ================================================================

begin;

-- ================================================================
-- A. Kreyol devient une categorie valide
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
  check (categorie in (
    'francais', 'culture', 'maths', 'kreyol',
    'religion', 'sport', 'eclair', 'bonus'
  ));


-- ================================================================
-- B. Le bareme officiel
-- ================================================================
insert into public.configuration_points (id, bareme, updated_at)
values (
  'bareme',
  '{
    "francais": {"points": 10,  "questions": 6},
    "culture":  {"points": 10,  "questions": 6},
    "maths":    {"points": 10,  "questions": 6},
    "kreyol":   {"points": 10,  "questions": 6},
    "religion": {"points": 10,  "questions": 6},
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
-- C. Les matchs a venir suivent l'ordre de la feuille
--    Les matchs termines gardent leur deroule d'origine.
-- ================================================================
update public.matches
set categories_ordre = '["francais","culture","maths","kreyol","religion","sport","eclair","bonus"]'::jsonb,
    updated_at = now()
where statut <> 'termine';


-- ================================================================
-- D. Verification
-- ================================================================
select
  ordre.i as etape,
  ordre.phase,
  (bareme -> ordre.phase ->> 'points')::int as question,
  (bareme -> ordre.phase ->> 'points')::int / 2 as replique,
  (bareme -> ordre.phase ->> 'questions')::int as nb,
  (bareme -> ordre.phase ->> 'questions')::int
    * ((bareme -> ordre.phase ->> 'points')::int
       + (bareme -> ordre.phase ->> 'points')::int / 2) as total_phase
from public.configuration_points,
     unnest(array['francais','culture','maths','kreyol','religion','sport','eclair','bonus'])
       with ordinality as ordre(phase, i)
where id = 'bareme'
order by ordre.i;

-- Attendu : 8 lignes, et la somme de total_phase = 915.
-- Si correct : commit;   sinon : rollback;

notify pgrst, 'reload schema';

commit;
