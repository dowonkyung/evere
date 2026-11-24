alter table public.evere_member_profiles
    add column reporter_email text not null default '',
    add constraint evere_reporter_email_format check (
        reporter_email = '' or (
            char_length(reporter_email) <= 254
            and reporter_email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$'
        )
    );

create or replace function public.evere_article_reporter_cards(target_article uuid)
returns table (reporter_id uuid, display_name text, position_title text, bio text, avatar_path text, public_email text)
language sql stable security definer set search_path = ''
as $$
    select m.id, m.display_name, coalesce(p.position_title, ''), coalesce(p.bio, ''), o.name, nullif(p.reporter_email, '')
    from public.evere_articles a
    cross join lateral unnest(a.byline) with ordinality as author(id, position)
    join public.evere_members m on m.id = author.id and m.removed_at is null
    left join public.evere_member_profiles p on p.member_id = m.id
    left join storage.objects o on o.bucket_id = 'evere-avatars' and o.name = m.id::text || '/profile'
    where a.id = target_article and a.status = 'published'
    order by author.position;
$$;
notify pgrst, 'reload schema';
