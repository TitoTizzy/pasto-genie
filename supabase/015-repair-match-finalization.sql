-- ================================================================
-- PASTO GENIE - Deblocage de la fin de match
-- A coller dans Supabase > SQL Editor > Run
--
-- Corrige deux blocages de finalize_match_stats :
--   1. La fonction exigeait une ligne match_en_cours. Or cette ligne
--      n'est creee que par le trigger au premier evenement marque.
--      Un match demarre sans aucune action du jury restait donc
--      bloque en "en_cours", sans aucun moyen de le terminer.
--   2. Seuls le superadmin et le jury assigne pouvaient valider.
--      Un admin qui n'etait pas le jury du match etait refuse.
-- ================================================================

-- Rappel de la definition du helper : ce script reste executable seul,
-- meme si les scripts precedents n'ont pas ete rejoues.
create or replace function public.is_admin_or_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role in ('admin', 'superadmin')
  );
$$;

grant execute on function public.is_admin_or_superadmin() to anon, authenticated, service_role;

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

  if not public.is_admin_or_superadmin()
     and not (public.is_jury_or_admin() and v_match.jury_id = auth.uid()) then
    raise exception 'Vous ne pouvez pas valider ce match';
  end if;

  if v_match.tournoi_id is null then
    raise exception 'Un match doit appartenir a un tournoi avant validation finale';
  end if;

  -- Le score live est optionnel : un match sans aucune action marquee
  -- se termine sur un 0-0 au lieu d'etre bloque.
  select * into v_live from public.match_en_cours where id = p_match_id;
  if not found then
    v_live.score_a := 0;
    v_live.score_b := 0;
    v_live.points_joueurs := '{}'::jsonb;
    v_live.score_par_categorie := '{}'::jsonb;
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

grant execute on function public.finalize_match_stats(uuid) to authenticated;

notify pgrst, 'reload schema';
