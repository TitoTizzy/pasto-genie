-- ================================================================
-- PASTO GENIE 2026 - Type de match (saison / phases finales)
-- A coller dans Supabase > SQL Editor > Run
-- A executer APRES 018.
--
-- Le tournoi se joue en deux temps :
--   1. 12 matchs de saison reguliere -> classement aux points
--   2. les 4 premieres equipes disputent les phases finales
--      (demi-finales 1-4 et 2-3, puis petite finale et finale)
--
-- Les matchs sont crees a la main depuis l'admin : cette colonne
-- distingue simplement a quelle etape appartient chaque rencontre.
-- ================================================================

begin;

alter table public.matches
  add column if not exists type_match text not null default 'saison';

do $$
begin
  alter table public.matches
    add constraint matches_type_match_check
    check (type_match in ('saison', 'demi', 'petite_finale', 'finale'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_matches_type on public.matches (tournoi_id, type_match);

-- Les matchs deja au calendrier sont ceux de la saison reguliere
update public.matches
set type_match = 'saison'
where type_match is null;

-- ================================================================
-- Classement de la saison reguliere : sert a designer les 4 qualifies
-- ================================================================
create or replace view public.v_classement_saison as
select
  s.tournoi_id,
  s.equipe_id,
  e.nom,
  e.embleme_url,
  e.couleur_primaire,
  count(*)::int as matchs,
  sum(case when s.gagne then 1 else 0 end)::int as victoires,
  sum(case when s.nul then 1 else 0 end)::int as nuls,
  sum(case when s.perdu then 1 else 0 end)::int as defaites,
  sum(s.score)::int as points_marques,
  sum(s.score_adverse)::int as points_encaisses,
  (sum(s.score) - sum(s.score_adverse))::int as difference,
  sum(case when s.gagne then 3 when s.nul then 1 else 0 end)::int as points_classement
from public.match_stats_equipes s
join public.matches m on m.id = s.match_id and m.type_match = 'saison'
left join public.equipes e on e.id = s.equipe_id
group by s.tournoi_id, s.equipe_id, e.nom, e.embleme_url, e.couleur_primaire;

grant select on public.v_classement_saison to anon, authenticated;

notify pgrst, 'reload schema';

-- Verification : les 4 premiers de chaque competition
-- select * from public.v_classement_saison
-- order by tournoi_id, points_classement desc, difference desc
-- limit 4;

commit;
