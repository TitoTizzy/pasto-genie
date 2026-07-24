-- ================================================================
-- PASTO GENIE 2026 - Equipes reelles et calendrier officiel
-- A coller dans Supabase > SQL Editor
--
-- ATTENTION : ce script SUPPRIME les equipes et matchs existants.
-- Executez d'abord l'ETAPE 0 seule pour voir ce qui sera efface.
-- ================================================================


-- ================================================================
-- ETAPE 0 - REVUE AVANT SUPPRESSION (executer seule, sans la suite)
-- ================================================================
-- select 'equipes' as objet, count(*) from public.equipes
-- union all select 'joueurs', count(*) from public.joueurs
-- union all select 'matchs', count(*) from public.matches
-- union all select 'matchs joues', count(*) from public.matches where statut <> 'planifie'
-- union all select 'stats figees', count(*) from public.match_stats_equipes;
--
-- Si "matchs joues" ou "stats figees" est > 0, ARRETEZ-VOUS :
-- il y a de vrais resultats en base, ne lancez pas la suite telle quelle.


begin;

-- ================================================================
-- ETAPE 1 - Nettoyage des donnees de test
-- ================================================================
delete from public.match_stats_joueurs;
delete from public.match_stats_equipes;
delete from public.match_evenements;
delete from public.match_en_cours;
delete from public.matches;
delete from public.tournoi_joueurs;
delete from public.tournoi_equipes;
delete from public.transferts_joueurs;
delete from public.joueurs;
delete from public.equipes;


-- ================================================================
-- ETAPE 2 - Le tournoi
-- ================================================================
insert into public.tournois (id, nom, annee, description, actif, format_type, regles, created_at, updated_at)
values (
  'b1000000-0000-4000-8000-000000000001',
  'PASTO GENIE 2026',
  2026,
  'Connaitre, Comprendre, Grandir - Plus qu''un jeu, une mission.',
  true,
  'Poules',
  '{"poules": ["Poule unique"], "calendrier_debut": "2026-07-26T14:00:00-04:00", "interval_minutes": 90}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set nom = excluded.nom,
    annee = excluded.annee,
    description = excluded.description,
    actif = true,
    updated_at = now();


-- ================================================================
-- ETAPE 3 - Les 8 equipes
-- ================================================================
insert into public.equipes (id, nom, paroisse, embleme_url, couleur_primaire, couleur_secondaire, actif, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'PJMM',            null, '', '#1d4ed8', '#facc15', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'ENFANT DE CHŒUR', null, '', '#b91c1c', '#fde68a', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'CARLO ACUTIS',    null, '', '#0f766e', '#5eead4', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000004', 'GRANDE CHORALE',  null, '', '#7e22ce', '#e9d5ff', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000005', 'LECTORAT',        null, '', '#c2410c', '#fed7aa', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000006', 'ACCUEIL',         null, '', '#0369a1', '#bae6fd', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000007', 'CHAPELLE',        null, '', '#166534', '#bbf7d0', true, now(), now()),
  ('a1000000-0000-4000-8000-000000000008', 'LAUDATO SI',      null, '', '#a16207', '#fef08a', true, now(), now())
on conflict (id) do update
set nom = excluded.nom,
    couleur_primaire = excluded.couleur_primaire,
    couleur_secondaire = excluded.couleur_secondaire,
    actif = true,
    updated_at = now();


-- ================================================================
-- ETAPE 4 - Inscription des 8 equipes au tournoi
-- ================================================================
insert into public.tournoi_equipes (tournoi_id, equipe_id, poule, statut, created_at, updated_at)
select 'b1000000-0000-4000-8000-000000000001', e.id, 'Poule unique', 'active', now(), now()
from public.equipes e
on conflict (tournoi_id, equipe_id) do nothing;


-- ================================================================
-- ETAPE 5 - Les 12 matchs du calendrier
--
-- Horaires : 14h00, 15h30 et 17h00 (heure locale UTC-4).
-- Ce sont des valeurs par defaut : corrigez-les depuis l'admin,
-- ou modifiez la colonne scheduled_at ci-dessous avant d'executer.
-- ================================================================
insert into public.matches (
  id, tournoi_id, tournament_name,
  equipe_a_id, equipe_b_id, equipe_a, equipe_b,
  categories_ordre, categorie_actuelle, statut,
  scheduled_at, created_at, updated_at
)
select
  cal.id,
  'b1000000-0000-4000-8000-000000000001',
  'PASTO GENIE 2026',
  ea.id,
  eb.id,
  jsonb_build_object(
    'id', ea.id, 'nom', ea.nom, 'paroisse', coalesce(ea.paroisse, ''),
    'embleme_url', coalesce(ea.embleme_url, ''),
    'couleur_primaire', ea.couleur_primaire, 'couleur_secondaire', ea.couleur_secondaire,
    'titulaires', '[]'::jsonb, 'remplacants', '[]'::jsonb
  ),
  jsonb_build_object(
    'id', eb.id, 'nom', eb.nom, 'paroisse', coalesce(eb.paroisse, ''),
    'embleme_url', coalesce(eb.embleme_url, ''),
    'couleur_primaire', eb.couleur_primaire, 'couleur_secondaire', eb.couleur_secondaire,
    'titulaires', '[]'::jsonb, 'remplacants', '[]'::jsonb
  ),
  '["francais","religion","culture","maths","sport","eclair"]'::jsonb,
  0,
  'planifie',
  cal.scheduled_at,
  now(),
  now()
from (values
  -- Dimanche 26 juillet 2026
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000002'::uuid, timestamptz '2026-07-26 14:00:00-04'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'a1000000-0000-4000-8000-000000000003'::uuid, 'a1000000-0000-4000-8000-000000000004'::uuid, timestamptz '2026-07-26 15:30:00-04'),
  -- Dimanche 2 aout 2026
  ('c1000000-0000-4000-8000-000000000003'::uuid, 'a1000000-0000-4000-8000-000000000005'::uuid, 'a1000000-0000-4000-8000-000000000006'::uuid, timestamptz '2026-08-02 14:00:00-04'),
  ('c1000000-0000-4000-8000-000000000004'::uuid, 'a1000000-0000-4000-8000-000000000007'::uuid, 'a1000000-0000-4000-8000-000000000008'::uuid, timestamptz '2026-08-02 15:30:00-04'),
  -- Dimanche 9 aout 2026
  ('c1000000-0000-4000-8000-000000000005'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000007'::uuid, timestamptz '2026-08-09 14:00:00-04'),
  ('c1000000-0000-4000-8000-000000000006'::uuid, 'a1000000-0000-4000-8000-000000000005'::uuid, 'a1000000-0000-4000-8000-000000000004'::uuid, timestamptz '2026-08-09 15:30:00-04'),
  ('c1000000-0000-4000-8000-000000000007'::uuid, 'a1000000-0000-4000-8000-000000000002'::uuid, 'a1000000-0000-4000-8000-000000000008'::uuid, timestamptz '2026-08-09 17:00:00-04'),
  -- Dimanche 16 aout 2026
  ('c1000000-0000-4000-8000-000000000008'::uuid, 'a1000000-0000-4000-8000-000000000003'::uuid, 'a1000000-0000-4000-8000-000000000006'::uuid, timestamptz '2026-08-16 14:00:00-04'),
  ('c1000000-0000-4000-8000-000000000009'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid, 'a1000000-0000-4000-8000-000000000008'::uuid, timestamptz '2026-08-16 15:30:00-04'),
  -- Dimanche 23 aout 2026
  ('c1000000-0000-4000-8000-000000000010'::uuid, 'a1000000-0000-4000-8000-000000000005'::uuid, 'a1000000-0000-4000-8000-000000000003'::uuid, timestamptz '2026-08-23 14:00:00-04'),
  ('c1000000-0000-4000-8000-000000000011'::uuid, 'a1000000-0000-4000-8000-000000000007'::uuid, 'a1000000-0000-4000-8000-000000000002'::uuid, timestamptz '2026-08-23 15:30:00-04'),
  ('c1000000-0000-4000-8000-000000000012'::uuid, 'a1000000-0000-4000-8000-000000000006'::uuid, 'a1000000-0000-4000-8000-000000000004'::uuid, timestamptz '2026-08-23 17:00:00-04')
) as cal(id, equipe_a_id, equipe_b_id, scheduled_at)
join public.equipes ea on ea.id = cal.equipe_a_id
join public.equipes eb on eb.id = cal.equipe_b_id;


-- ================================================================
-- ETAPE 6 - Verification
-- ================================================================
select
  to_char(m.scheduled_at at time zone 'America/Port-au-Prince', 'DD/MM/YYYY HH24:MI') as quand,
  m.equipe_a ->> 'nom' as equipe_a,
  m.equipe_b ->> 'nom' as equipe_b
from public.matches m
order by m.scheduled_at;

-- Attendu : 12 lignes, du 26/07 au 23/08.
-- Si tout est correct :   commit;
-- Sinon :                 rollback;

commit;
