create table evere_private.opinion_public_portraits (
    member_id uuid primary key references public.evere_members(id) on delete cascade
);

alter table evere_private.opinion_public_portraits enable row level security;
revoke all on table evere_private.opinion_public_portraits from public, anon, authenticated;

insert into evere_private.opinion_public_portraits (member_id)
select min(m.id::text)::uuid
from public.evere_members m
where m.removed_at is null and m.display_name in ('은혜누나', '원세민')
group by m.display_name
having count(*) = 1;

create function evere_private.is_public_opinion_portrait(object_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from evere_private.opinion_public_portraits p
        join public.evere_members m on m.id = p.member_id and m.removed_at is null
        where object_name = p.member_id::text || '/profile'
    );
$$;
revoke all on function evere_private.is_public_opinion_portrait(text) from public;
grant execute on function evere_private.is_public_opinion_portrait(text) to anon, authenticated;

create policy evere_avatar_opinion_portraits on storage.objects
for select to anon, authenticated
using (bucket_id = 'evere-avatars' and evere_private.is_public_opinion_portrait(name));
