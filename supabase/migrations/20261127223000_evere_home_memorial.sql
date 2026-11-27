create table public.evere_home_memorial (
    id boolean primary key default true check (id),
    victim_count integer check (victim_count >= 0)
);
alter table public.evere_home_memorial enable row level security;
insert into public.evere_home_memorial default values;
grant select on public.evere_home_memorial to anon, authenticated;
grant update (victim_count) on public.evere_home_memorial to authenticated;

create policy evere_home_memorial_public_read on public.evere_home_memorial
for select to anon, authenticated using (true);

create policy evere_home_memorial_editor_update on public.evere_home_memorial
for update to authenticated
using ((select evere_private.member_role()) in ('owner', 'director'))
with check ((select evere_private.member_role()) in ('owner', 'director'));
