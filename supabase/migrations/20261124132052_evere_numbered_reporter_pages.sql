alter table public.evere_members add column member_number bigint;
create sequence public.evere_member_number_seq owned by public.evere_members.member_number;
with ranked as (
    select m.id, row_number() over (order by u.created_at, m.id) as number
    from public.evere_members m join auth.users u on u.id = m.id
)
update public.evere_members m set member_number = ranked.number from ranked where ranked.id = m.id;
select setval('public.evere_member_number_seq', coalesce(max(member_number), 1), count(*) > 0) from public.evere_members;
alter table public.evere_members
    alter column member_number set default nextval('public.evere_member_number_seq'),
    alter column member_number set not null,
    add constraint evere_members_member_number_unique unique (member_number);

create function public.evere_reporter_profile(target_number bigint)
returns table (reporter_id uuid, display_name text, position_title text, bio text, avatar_path text, public_email text)
language sql stable security definer set search_path = ''
as $$
    select m.id, m.display_name, coalesce(p.position_title, ''), coalesce(p.bio, ''), o.name, nullif(p.reporter_email, '')
    from public.evere_members m
    left join public.evere_member_profiles p on p.member_id = m.id
    left join storage.objects o on o.bucket_id = 'evere-avatars' and o.name = m.id::text || '/profile'
    where m.member_number = target_number and m.removed_at is null
      and (m.role <> 'citizen' or exists (
          select 1 from public.evere_articles a where a.status = 'published' and a.byline @> array[m.id]
      ));
$$;
revoke all on function public.evere_reporter_profile(bigint) from public, anon, authenticated;
grant execute on function public.evere_reporter_profile(bigint) to anon, authenticated;

drop function public.evere_article_reporter_cards(uuid);
create function public.evere_article_reporter_cards(target_article uuid)
returns table (reporter_id uuid, display_name text, position_title text, bio text, avatar_path text, public_email text, reporter_number bigint)
language sql stable security definer set search_path = ''
as $$
    select m.id, m.display_name, coalesce(p.position_title, ''), coalesce(p.bio, ''), o.name, nullif(p.reporter_email, ''), m.member_number
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

create function public.evere_owner_members_numbered()
returns table (id uuid, display_name text, role public.evere_role, sectors public.evere_sector[], email text,
    joined_at timestamptz, last_sign_in_at timestamptz, position_title text, avatar_path text, member_number bigint)
language sql stable security definer set search_path = ''
as $$
    select m.*, member.member_number
    from public.evere_owner_members() m
    join public.evere_members member on member.id = m.id
    order by member.member_number;
$$;
revoke all on function public.evere_owner_members_numbered() from public, anon, authenticated;
grant execute on function public.evere_owner_members_numbered() to authenticated;
notify pgrst, 'reload schema';
