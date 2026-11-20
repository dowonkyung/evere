create table public.evere_member_profiles (
    member_id uuid primary key references public.evere_members(id) on delete cascade,
    position_title text not null default '' check (char_length(trim(position_title)) <= 60),
    bio text not null default '' check (char_length(trim(bio)) <= 500)
);
alter table public.evere_member_profiles enable row level security;
revoke all on public.evere_member_profiles from public, anon, authenticated;
grant select, insert, update on public.evere_member_profiles to authenticated;

create policy evere_profile_read on public.evere_member_profiles for select to authenticated
using (member_id = (select auth.uid()));
create policy evere_profile_create on public.evere_member_profiles for insert to authenticated
with check (member_id = (select auth.uid()));
create policy evere_profile_edit on public.evere_member_profiles for update to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evere-avatars', 'evere-avatars', false, 3145728, array['image/jpeg','image/png','image/webp']);

create policy evere_avatar_read on storage.objects for select to authenticated
using (bucket_id = 'evere-avatars' and name = ((select auth.uid())::text || '/profile'));
create policy evere_avatar_add on storage.objects for insert to authenticated
with check (
    bucket_id = 'evere-avatars' and name = ((select auth.uid())::text || '/profile')
    and exists (select 1 from public.evere_members where id = (select auth.uid()))
);
create policy evere_avatar_replace on storage.objects for update to authenticated
using (bucket_id = 'evere-avatars' and name = ((select auth.uid())::text || '/profile'))
with check (
    bucket_id = 'evere-avatars' and name = ((select auth.uid())::text || '/profile')
    and exists (select 1 from public.evere_members where id = (select auth.uid()))
);
create policy evere_avatar_remove on storage.objects for delete to authenticated
using (bucket_id = 'evere-avatars' and name = ((select auth.uid())::text || '/profile'));
