-- ChainThings: storage bucket + RLS policies

insert into storage.buckets (id, name, public, file_size_limit)
values ('chainthings-uploads', 'chainthings-uploads', false, 52428800);

-- Users can only access files in their own tenant folder
create policy "Tenant upload access"
  on storage.objects for all
  using (
    bucket_id = 'chainthings-uploads'
    and (storage.foldername(name))[1] = public.chainthings_current_tenant_id()::text
  );
