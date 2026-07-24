-- ================================================================
-- PASTO GENIE - Reparation creation competition + RLS tournois
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

alter table public.tournois
  add column if not exists format_type text default 'Poules',
  add column if not exists regles jsonb default '{}'::jsonb;

update public.tournois
set
  format_type = coalesce(format_type, 'Poules'),
  regles = coalesce(regles, '{}'::jsonb);

insert into public.users (id, email, display_name, role, created_at)
values (
  'd36019b9-2da9-42b7-9498-3bd2589260d8',
  'jeenparvaty23@gmail.com',
  'Administrateur',
  'superadmin',
  now()
)
on conflict (id) do update
set
  email = excluded.email,
  display_name = coalesce(public.users.display_name, excluded.display_name),
  role = 'superadmin';

grant select on public.tournois to anon, authenticated;
grant insert, update, delete on public.tournois to authenticated;
grant execute on function public.is_superadmin() to anon, authenticated;

alter table public.tournois enable row level security;

drop policy if exists "tournois_public_read" on public.tournois;
create policy "tournois_public_read"
on public.tournois for select
using (true);

drop policy if exists "tournois_admin_write" on public.tournois;
create policy "tournois_admin_write"
on public.tournois for all
using (public.is_superadmin())
with check (public.is_superadmin());
