-- ================================================================
-- PASTO GENIE - Repair Edge Function service_role permissions
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all routines in schema public to service_role;

grant select, insert, update, delete on public.users to service_role;

-- Garder les futures tables accessibles aux Edge Functions serveur.
alter default privileges in schema public
grant all privileges on tables to service_role;

alter default privileges in schema public
grant all privileges on sequences to service_role;

alter default privileges in schema public
grant execute on functions to service_role;
