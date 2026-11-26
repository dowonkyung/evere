alter policy evere_editorial_read on public.evere_articles
  using ((select evere_private.member_role()) <> 'citizen');

alter policy evere_article_submit on public.evere_articles
  with check (
    created_by = (select auth.uid())
    and status = 'pending'
    and editorial_state in ('draft', 'complete')
    and (select evere_private.member_role()) <> 'citizen'
  );

create or replace function evere_private.newsroom_photo_scope(object_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
    select evere_private.member_role() <> 'citizen' and exists (
        select 1 from public.evere_articles a where a.photo_paths @> array[object_name]
    );
$$;

alter policy evere_photo_read on storage.objects
using (
    bucket_id = 'evere-article-photos' and (
        (split_part(name, '/', 1) = (select auth.uid())::text
         and (select evere_private.member_role()) <> 'citizen')
        or exists (select 1 from public.evere_articles a where a.photo_paths @> array[objects.name])
    )
);

alter policy evere_audio_owner_read on storage.objects
using (
    bucket_id = 'evere-article-audio'
    and (select evere_private.member_role()) <> 'citizen'
    and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy evere_article_media_staff_insert on storage.objects
as restrictive for insert to authenticated
with check (
    bucket_id not in ('evere-article-audio', 'evere-article-photos')
    or (select evere_private.member_role()) <> 'citizen'
);

create policy evere_article_media_staff_delete on storage.objects
as restrictive for delete to authenticated
using (
    bucket_id not in ('evere-article-audio', 'evere-article-photos')
    or (select evere_private.member_role()) <> 'citizen'
);

create policy evere_comment_author_update on public.evere_comments
for update to authenticated
using (
    author_id = (select auth.uid())
    and (select evere_private.member_role()) is not null
    and exists (select 1 from public.evere_articles a where a.id = article_id and a.status = 'published')
)
with check (
    author_id = (select auth.uid())
    and (select evere_private.member_role()) is not null
    and exists (select 1 from public.evere_articles a where a.id = article_id and a.status = 'published')
);

create policy evere_comment_author_delete on public.evere_comments
for delete to authenticated
using (
    author_id = (select auth.uid())
    and (select evere_private.member_role()) is not null
    and exists (select 1 from public.evere_articles a where a.id = article_id and a.status = 'published')
);
