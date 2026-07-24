-- ================================================================
-- PASTO GENIE - Format et regles de competition
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

alter table public.tournois
  add column if not exists format_type text default 'Poules',
  add column if not exists regles jsonb default '{}'::jsonb;

update public.tournois
set
  format_type = coalesce(format_type, 'Poules'),
  regles = coalesce(regles, '{}'::jsonb);
