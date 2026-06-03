-- ================================================================
-- PASTO GENIE - Poules d'equipes pour classements publics
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

alter table public.equipes
  add column if not exists poule text default 'Poule unique';

create or replace view public.v_classement_equipes as
select
  s.equipe_id,
  e.nom,
  e.paroisse,
  e.poule,
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
group by s.equipe_id, e.nom, e.paroisse, e.poule, e.embleme_url, e.couleur_primaire;

grant select on public.v_classement_equipes to anon, authenticated;
