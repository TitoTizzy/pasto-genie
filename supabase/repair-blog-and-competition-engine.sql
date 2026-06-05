-- ================================================================
-- PASTO GENIE - Blog + moteur competition
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

create extension if not exists pgcrypto;

create table if not exists public.blog_articles (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  categorie text default 'Actualites',
  resume text,
  contenu text,
  image_url text,
  statut text not null default 'published' check (statut in ('draft', 'published')),
  auteur_id uuid references public.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz
);

alter table public.blog_articles
  add column if not exists image_url text;

alter table public.blog_articles enable row level security;

grant select on public.blog_articles to anon, authenticated;
grant insert, update, delete on public.blog_articles to authenticated;
grant all privileges on public.blog_articles to service_role;

drop policy if exists "blog_public_read_published" on public.blog_articles;
create policy "blog_public_read_published"
on public.blog_articles for select
using (statut = 'published' or public.is_superadmin());

drop policy if exists "blog_admin_write" on public.blog_articles;
create policy "blog_admin_write"
on public.blog_articles for all
using (public.is_superadmin())
with check (public.is_superadmin());

alter table public.tournois
  add column if not exists format_type text default 'Poules',
  add column if not exists regles jsonb default '{}'::jsonb;

create table if not exists public.tournoi_equipes (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  poule text not null default 'Poule unique',
  statut text not null default 'active' check (statut in ('active', 'retiree', 'disqualifiee')),
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (tournoi_id, equipe_id)
);

create table if not exists public.tournoi_joueurs (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  joueur_id uuid not null references public.joueurs(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  statut text not null default 'active' check (statut in ('active', 'suspendu', 'transfere', 'retire')),
  date_debut timestamptz default now(),
  date_fin timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (tournoi_id, joueur_id)
);

create table if not exists public.transferts_joueurs (
  id uuid primary key default gen_random_uuid(),
  tournoi_id uuid not null references public.tournois(id) on delete cascade,
  joueur_id uuid not null references public.joueurs(id) on delete cascade,
  ancienne_equipe_id uuid references public.equipes(id) on delete set null,
  nouvelle_equipe_id uuid not null references public.equipes(id) on delete cascade,
  note text,
  created_at timestamptz default now()
);

alter table public.tournoi_equipes enable row level security;
alter table public.tournoi_joueurs enable row level security;
alter table public.transferts_joueurs enable row level security;

grant select on public.tournoi_equipes to anon, authenticated;
grant insert, update, delete on public.tournoi_equipes to authenticated;
grant select on public.tournoi_joueurs to anon, authenticated;
grant insert, update, delete on public.tournoi_joueurs to authenticated;
grant select on public.transferts_joueurs to authenticated;
grant insert, update, delete on public.transferts_joueurs to authenticated;
grant all privileges on public.tournoi_equipes to service_role;
grant all privileges on public.tournoi_joueurs to service_role;
grant all privileges on public.transferts_joueurs to service_role;

drop policy if exists "tournoi_equipes_public_read" on public.tournoi_equipes;
create policy "tournoi_equipes_public_read" on public.tournoi_equipes for select using (true);
drop policy if exists "tournoi_equipes_admin_write" on public.tournoi_equipes;
create policy "tournoi_equipes_admin_write" on public.tournoi_equipes for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "tournoi_joueurs_public_read" on public.tournoi_joueurs;
create policy "tournoi_joueurs_public_read" on public.tournoi_joueurs for select using (true);
drop policy if exists "tournoi_joueurs_admin_write" on public.tournoi_joueurs;
create policy "tournoi_joueurs_admin_write" on public.tournoi_joueurs for all
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "transferts_admin_read" on public.transferts_joueurs;
create policy "transferts_admin_read" on public.transferts_joueurs for select
using (public.is_superadmin());
drop policy if exists "transferts_admin_write" on public.transferts_joueurs;
create policy "transferts_admin_write" on public.transferts_joueurs for all
using (public.is_superadmin())
with check (public.is_superadmin());
