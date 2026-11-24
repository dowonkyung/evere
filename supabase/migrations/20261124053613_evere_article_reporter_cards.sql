create function public.evere_article_reporter_cards(target_article uuid)
returns table (reporter_id uuid, display_name text, position_title text, bio text, avatar_path text)
language sql stable security definer set search_path = ''
as $$
    select m.id, m.display_name, coalesce(p.position_title, ''), coalesce(p.bio, ''), o.name
    from public.evere_articles a
    cross join lateral unnest(a.byline) with ordinality as author(id, position)
    join public.evere_members m on m.id = author.id and m.removed_at is null
    left join public.evere_member_profiles p on p.member_id = m.id
    left join storage.objects o on o.bucket_id = 'evere-avatars' and o.name = m.id::text || '/profile'
    where a.id = target_article and a.status = 'published'
    order by author.position;
$$;
revoke all on function public.evere_article_reporter_cards(uuid) from public, anon, authenticated;
grant execute on function public.evere_article_reporter_cards(uuid) to anon, authenticated;

create function evere_private.is_public_reporter_avatar(object_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.evere_members m
        where m.removed_at is null and object_name = m.id::text || '/profile'
          and exists (select 1 from public.evere_articles a where a.status = 'published' and a.byline @> array[m.id])
    );
$$;
revoke all on function evere_private.is_public_reporter_avatar(text) from public, anon, authenticated;
-- The policy calls by OID; keeping schema usage private prevents direct anonymous RPC access.
grant execute on function evere_private.is_public_reporter_avatar(text) to anon, authenticated;
create policy evere_published_reporter_avatar on storage.objects for select to anon, authenticated
using (bucket_id = 'evere-avatars' and evere_private.is_public_reporter_avatar(name));
notify pgrst, 'reload schema';
