-- ================================================================
-- PASTO GENIE - Quels scripts sont deja passes ?
--
-- Lecture seule : cette requete ne modifie rien.
-- Colle-la dans Supabase > SQL Editor > Run.
--
-- Chaque ligne cherche une trace laissee par un script (une table,
-- une colonne, une fonction, une policy). "OK" = deja execute.
-- ================================================================

with verif as (
  select 1 as ordre,
    '001-schema-and-policies.sql' as script,
    to_regclass('public.match_evenements') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'is_superadmin') as fait,
    'Tables de base, RLS, trigger de score' as contenu

  union all select 2,
    '005-league-platform-upgrade.sql',
    to_regclass('public.equipes') is not null
      and to_regclass('public.match_stats_equipes') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'finalize_match_stats'),
    'Equipes, joueurs, statistiques figees, classements'

  union all select 3,
    '006-storage-media-bucket.sql',
    exists (select 1 from storage.buckets where id = 'pasto-media'),
    'Bucket images (emblemes, photos joueurs)'

  union all select 4,
    '008-repair-tournois-rls-and-competition.sql',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'tournois' and column_name = 'format_type'),
    'Colonnes format_type et regles sur tournois'

  union all select 5,
    '009-add-team-pools.sql',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'equipes' and column_name = 'poule'),
    'Poules d''equipes'

  union all select 6,
    '010-repair-blog-and-competition-engine.sql',
    to_regclass('public.blog_articles') is not null
      and to_regclass('public.tournoi_equipes') is not null,
    'Blog, inscriptions au tournoi, transferts'

  union all select 7,
    '011-repair-roles-and-user-permissions.sql',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'users' and column_name = 'permissions'),
    'Roles officiels et permissions utilisateurs'

  union all select 8,
    '012-generate-tournament-matches.sql',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'generer_matchs_competition'),
    'Generateur de calendrier cote serveur (non utilise par l''app)'

  union all select 9,
    '013-repair-admin-match-policies.sql',
    exists (select 1 from pg_policies
            where schemaname = 'public' and tablename = 'matches' and policyname = 'matches_admin_insert'),
    'Droits d''ecriture des matchs pour le role admin'

  union all select 10,
    '014-repair-team-transfer-history.sql',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'transferts_joueurs'
              and column_name = 'tournoi_id' and is_nullable = 'YES'),
    'Transferts de joueurs sans tournoi obligatoire'

  -- ---- Les trois scripts recents ----

  union all select 11,
    '015-repair-match-finalization.sql',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'finalize_match_stats'
              and pg_get_functiondef(p.oid) like '%is_admin_or_superadmin%'),
    'Deblocage de la fin de match'

  union all select 12,
    '016-bareme-2026.sql',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'recalculer_score_match')
      and exists (select 1 from public.configuration_points
                  where id = 'bareme' and bareme ? 'bonus'),
    'Bareme 10/50/100, replique de moitie, recalcul depuis le journal'

  union all select 13,
    '017-seed-pasto-genie-2026.sql',
    exists (select 1 from public.equipes where nom = 'PJMM')
      and (select count(*) from public.matches) >= 12,
    'Les 8 equipes reelles et les 12 matchs'

  union all select 14,
    '018-moteur-juges-et-chrono.sql',
    to_regclass('public.avis_juges') is not null
      and to_regclass('public.match_juges') is not null
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'soumettre_avis'),
    '4 juges, validation a deux, corrections, chrono de reponse'

  union all select 15,
    '019-type-de-match.sql',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'matches' and column_name = 'type_match'),
    'Saison reguliere et phases finales + classement de saison'

  union all select 16,
    '020-feuille-de-match-officielle.sql',
    exists (select 1 from public.configuration_points
            where id = 'bareme' and bareme ? 'kreyol')
      and exists (select 1 from pg_constraint
                  where conrelid = 'public.match_evenements'::regclass
                    and pg_get_constraintdef(oid) ilike '%kreyol%'),
    'Bareme officiel /915 avec la categorie KREYOL'

  union all select 17,
    '021-questions-du-match.sql',
    to_regclass('public.questions_match') is not null
      and exists (select 1 from pg_constraint
                  where conrelid = 'public.match_juges'::regclass
                    and pg_get_constraintdef(oid) ilike '%TOUS%'),
    'Questions preparees avant le match, 1 a 4 juges'
)
select
  ordre as "#",
  case when fait then 'OK' else '>>> A EXECUTER' end as etat,
  script,
  contenu
from verif
order by ordre;
