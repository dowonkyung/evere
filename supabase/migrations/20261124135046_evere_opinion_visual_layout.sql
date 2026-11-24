create table public.evere_opinion_layout (
    area text primary key check (area in ('editorial', 'columns', 'named', 'writers')),
    items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 120)
);
alter table public.evere_opinion_layout enable row level security;
revoke all on public.evere_opinion_layout from public, anon, authenticated;
grant select on public.evere_opinion_layout to anon, authenticated;
grant insert, update on public.evere_opinion_layout to authenticated;
create policy evere_opinion_layout_read on public.evere_opinion_layout for select to anon, authenticated using (true);
create policy evere_opinion_layout_manage on public.evere_opinion_layout for all to authenticated
using ((select evere_private.can_edit_page('opinion')))
with check ((select evere_private.can_edit_page('opinion')));

insert into evere_private.opinion_public_portraits (member_id)
select min(id::text)::uuid from public.evere_members
where removed_at is null and display_name = '리조니'
having count(*) = 1
on conflict (member_id) do nothing;

notify pgrst, 'reload schema';
