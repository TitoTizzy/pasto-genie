-- ================================================================
-- PASTO GENIE - RLS admin pour generation et gestion des matchs
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

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

grant select on public.matches to anon, authenticated;
grant insert, update, delete on public.matches to authenticated;

grant select on public.match_en_cours to anon, authenticated;
grant insert, update, delete on public.match_en_cours to authenticated;

grant select on public.match_evenements to anon, authenticated;
grant insert, update, delete on public.match_evenements to authenticated;

alter table public.matches enable row level security;
alter table public.match_en_cours enable row level security;
alter table public.match_evenements enable row level security;

drop policy if exists "matches_public_read" on public.matches;
create policy "matches_public_read"
on public.matches
for select
using (true);

drop policy if exists "matches_admin_write" on public.matches;
drop policy if exists "matches_admin_insert" on public.matches;
drop policy if exists "matches_admin_update" on public.matches;
drop policy if exists "matches_admin_delete" on public.matches;

create policy "matches_admin_insert"
on public.matches
for insert
to authenticated
with check (public.is_admin_or_superadmin());

create policy "matches_admin_update"
on public.matches
for update
to authenticated
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

create policy "matches_admin_delete"
on public.matches
for delete
to authenticated
using (public.is_admin_or_superadmin());

drop policy if exists "live_public_read" on public.match_en_cours;
create policy "live_public_read"
on public.match_en_cours
for select
using (true);

drop policy if exists "live_admin_write" on public.match_en_cours;
drop policy if exists "live_admin_insert" on public.match_en_cours;
drop policy if exists "live_admin_update" on public.match_en_cours;
drop policy if exists "live_admin_delete" on public.match_en_cours;

create policy "live_admin_insert"
on public.match_en_cours
for insert
to authenticated
with check (public.is_admin_or_superadmin());

create policy "live_admin_update"
on public.match_en_cours
for update
to authenticated
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

create policy "live_admin_delete"
on public.match_en_cours
for delete
to authenticated
using (public.is_admin_or_superadmin());

drop policy if exists "events_public_read" on public.match_evenements;
create policy "events_public_read"
on public.match_evenements
for select
using (true);

drop policy if exists "events_admin_write" on public.match_evenements;
drop policy if exists "events_admin_insert" on public.match_evenements;
drop policy if exists "events_admin_update" on public.match_evenements;
drop policy if exists "events_admin_delete" on public.match_evenements;

create policy "events_admin_insert"
on public.match_evenements
for insert
to authenticated
with check (public.is_admin_or_superadmin());

create policy "events_admin_update"
on public.match_evenements
for update
to authenticated
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

create policy "events_admin_delete"
on public.match_evenements
for delete
to authenticated
using (public.is_admin_or_superadmin());

notify pgrst, 'reload schema';
