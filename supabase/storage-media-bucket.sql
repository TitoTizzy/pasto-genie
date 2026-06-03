-- ================================================================
-- PASTO GENIE - Bucket images equipes et joueurs
-- A coller dans Supabase > SQL Editor > Run
-- ================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pasto-media',
  'pasto-media',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 4194304,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

drop policy if exists "pasto_media_public_read" on storage.objects;
create policy "pasto_media_public_read"
on storage.objects for select
using (bucket_id = 'pasto-media');

drop policy if exists "pasto_media_admin_insert" on storage.objects;
create policy "pasto_media_admin_insert"
on storage.objects for insert
with check (
  bucket_id = 'pasto-media'
  and public.is_superadmin()
);

drop policy if exists "pasto_media_admin_update" on storage.objects;
create policy "pasto_media_admin_update"
on storage.objects for update
using (
  bucket_id = 'pasto-media'
  and public.is_superadmin()
)
with check (
  bucket_id = 'pasto-media'
  and public.is_superadmin()
);

drop policy if exists "pasto_media_admin_delete" on storage.objects;
create policy "pasto_media_admin_delete"
on storage.objects for delete
using (
  bucket_id = 'pasto-media'
  and public.is_superadmin()
);
