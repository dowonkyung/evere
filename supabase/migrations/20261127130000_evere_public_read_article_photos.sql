alter policy evere_photo_read on storage.objects
to authenticated
using (
    bucket_id = 'evere-article-photos' and (
        (split_part(name, '/', 1) = (select auth.uid())::text
         and (select evere_private.member_role()) <> 'citizen')
        or exists (select 1 from public.evere_articles a where a.photo_paths @> array[objects.name])
    )
);

create policy evere_photo_public_read on storage.objects
for select to anon
using (
    bucket_id = 'evere-article-photos' and exists (
        select 1 from public.evere_articles a
        where a.status = 'published' and a.photo_paths @> array[objects.name]
    )
);
