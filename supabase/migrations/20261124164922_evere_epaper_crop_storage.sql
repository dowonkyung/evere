alter table public.evere_epaper_regions add column png_path text;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('evere-epaper-crops','evere-epaper-crops',true,26214400,array['image/png']);
create policy "Owner uploads e-paper crops" on storage.objects for insert to authenticated with check (
 bucket_id = 'evere-epaper-crops' and exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
create policy "Owner reads e-paper crop records" on storage.objects for select to authenticated using (
 bucket_id = 'evere-epaper-crops' and exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
create policy "Owner removes e-paper crops" on storage.objects for delete to authenticated using (
 bucket_id = 'evere-epaper-crops' and exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
