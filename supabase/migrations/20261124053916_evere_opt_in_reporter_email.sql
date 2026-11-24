alter table public.evere_member_profiles add column publish_login_email boolean not null default false;
drop function public.evere_article_reporter_cards(uuid);
create function public.evere_article_reporter_cards(target_article uuid)
returns table (reporter_id uuid, display_name text, position_title text, bio text, avatar_path text, public_email text)
language sql stable security definer set search_path = ''
as $$
    select m.id, m.display_name, coalesce(p.position_title, ''), coalesce(p.bio, ''), o.name, u.email::text
    from public.evere_articles a
    cross join lateral unnest(a.byline) with ordinality as author(id, position)
    join public.evere_members m on m.id = author.id and m.removed_at is null
    left join public.evere_member_profiles p on p.member_id = m.id
    left join auth.users u on u.id = m.id and p.publish_login_email
    left join storage.objects o on o.bucket_id = 'evere-avatars' and o.name = m.id::text || '/profile'
    where a.id = target_article and a.status = 'published'
    order by author.position;
$$;
revoke all on function public.evere_article_reporter_cards(uuid) from public, anon, authenticated;
grant execute on function public.evere_article_reporter_cards(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
