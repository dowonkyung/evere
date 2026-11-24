insert into evere_private.opinion_public_portraits (member_id)
select id from public.evere_members
where role = 'owner' and removed_at is null and display_name = '혼종인'
on conflict (member_id) do nothing;
