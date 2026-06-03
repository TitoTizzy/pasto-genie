-- ================================================================
-- PASTO GENIE - Repair tables manquantes + permissions
-- A coller dans Supabase SQL Editor si une table manque.
-- ================================================================

create table if not exists public.regles_jeu (
  id text primary key,
  texte text not null,
  updated_at timestamptz
);

create table if not exists public.logs_match (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete cascade,
  event_id uuid,
  payload jsonb,
  created_at timestamptz default now()
);

alter table public.regles_jeu enable row level security;
alter table public.logs_match enable row level security;

grant usage on schema public to anon, authenticated;

grant execute on function public.current_user_role() to anon, authenticated;
grant execute on function public.is_superadmin() to anon, authenticated;
grant execute on function public.is_jury_or_admin() to anon, authenticated;

grant select on public.users to authenticated;
grant insert, update, delete on public.users to authenticated;

grant select on public.tournois to anon, authenticated;
grant insert, update, delete on public.tournois to authenticated;

grant select on public.matches to anon, authenticated;
grant insert, update, delete on public.matches to authenticated;

grant select on public.match_en_cours to anon, authenticated;
grant insert, update, delete on public.match_en_cours to authenticated;

grant select on public.match_evenements to anon, authenticated;
grant insert, delete on public.match_evenements to authenticated;

grant select on public.configuration_points to anon, authenticated;
grant insert, update, delete on public.configuration_points to authenticated;

grant select on public.regles_jeu to anon, authenticated;
grant insert, update, delete on public.regles_jeu to authenticated;

grant select on public.logs_match to authenticated;

drop policy if exists "rules_public_read" on public.regles_jeu;
create policy "rules_public_read"
on public.regles_jeu for select
using (true);

drop policy if exists "rules_admin_write" on public.regles_jeu;
create policy "rules_admin_write"
on public.regles_jeu for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "logs_admin_read" on public.logs_match;
create policy "logs_admin_read"
on public.logs_match for select
using (public.is_superadmin());
