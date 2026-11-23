insert into evere_private.opinion_public_portraits (member_id)
select min(id::text)::uuid
from public.evere_members
where removed_at is null and display_name = '마대처'
having count(*) = 1
on conflict (member_id) do nothing;
