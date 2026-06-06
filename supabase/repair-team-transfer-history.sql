-- ================================================================
-- PASTO GENIE - Transferts joueurs equipe -> equipe
-- A coller dans Supabase > SQL Editor > Run si l'historique des transferts
-- reclame encore un tournoi_id.
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

create table if not exists public.transferts_joueurs (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid references public.tournois(id) on delete set null,
  joueur_id uuid references public.joueurs(id) on delete cascade,
  ancienne_equipe_id uuid references public.equipes(id) on delete set null,
  nouvelle_equipe_id uuid references public.equipes(id) on delete set null,
  note text,
  created_at timestamptz default now()
);

alter table public.transferts_joueurs
  alter column tournoi_id drop not null;

grant select, insert, update, delete on public.transferts_joueurs to authenticated;

alter table public.transferts_joueurs enable row level security;

drop policy if exists "transferts_admin_read" on public.transferts_joueurs;
create policy "transferts_admin_read"
on public.transferts_joueurs
for select
to authenticated
using (public.is_admin_or_superadmin());

drop policy if exists "transferts_admin_write" on public.transferts_joueurs;
create policy "transferts_admin_write"
on public.transferts_joueurs
for all
to authenticated
using (public.is_admin_or_superadmin())
with check (public.is_admin_or_superadmin());

notify pgrst, 'reload schema';
