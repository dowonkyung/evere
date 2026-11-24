create function evere_private.newsroom_photo_scope(object_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
    select evere_private.member_role() is not null and exists (
        select 1 from public.evere_articles a where a.photo_paths @> array[object_name]
    );
$$;
revoke all on function evere_private.newsroom_photo_scope(text) from public, anon, authenticated;
grant execute on function evere_private.newsroom_photo_scope(text) to authenticated;

create policy evere_photo_newsroom_library on storage.objects
for select to authenticated
using (bucket_id = 'evere-article-photos' and evere_private.newsroom_photo_scope(name));

create function evere_private.newsroom_photo_library()
returns table (id uuid, title text, photo_html text, photo_paths text[], published_at timestamptz, library_date timestamptz)
language sql stable security definer set search_path = ''
as $$
    select a.id, case when a.status = 'published' then a.title end,
           coalesce(captions.photo_html, ''), a.photo_paths, a.published_at,
           coalesce(a.published_at, a.created_at)
    from public.evere_articles a
    left join lateral (
        select string_agg(
            '<figure data-photo="' || matched.parts[1] || '"><figcaption>' ||
            coalesce(matched.parts[2], '') || '</figcaption></figure>', ''
        ) as photo_html
        from regexp_matches(
            a.body_html,
            '<figure[[:space:]][^>]*data-photo="([a-fA-F0-9-]{36}/[a-fA-F0-9-]{36}\.(?:jpg|png|webp))"[^>]*>[[:space:]]*<figcaption[^>]*>(.*?)</figcaption>[[:space:]]*</figure>',
            'gi'
        ) matched(parts)
        where matched.parts[1] = any(a.photo_paths)
    ) captions on true
    where evere_private.member_role() is not null
      and cardinality(a.photo_paths) > 0;
$$;
revoke all on function evere_private.newsroom_photo_library() from public, anon, authenticated;
grant execute on function evere_private.newsroom_photo_library() to authenticated;

create function public.evere_newsroom_photo_library()
returns table (id uuid, title text, photo_html text, photo_paths text[], published_at timestamptz, library_date timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from evere_private.newsroom_photo_library(); $$;
revoke all on function public.evere_newsroom_photo_library() from public, anon, authenticated;
grant execute on function public.evere_newsroom_photo_library() to authenticated;
notify pgrst, 'reload schema';
