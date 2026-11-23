create policy evere_avatar_owner_add on storage.objects for insert to authenticated
with check (
    bucket_id = 'evere-avatars'
    and (select evere_private.member_role()) = 'owner'
    and exists (select 1 from public.evere_members m where objects.name = m.id::text || '/profile')
);

create policy evere_avatar_owner_replace on storage.objects for update to authenticated
using (
    bucket_id = 'evere-avatars'
    and (select evere_private.member_role()) = 'owner'
    and exists (select 1 from public.evere_members m where objects.name = m.id::text || '/profile')
)
with check (
    bucket_id = 'evere-avatars'
    and (select evere_private.member_role()) = 'owner'
    and exists (select 1 from public.evere_members m where objects.name = m.id::text || '/profile')
);
