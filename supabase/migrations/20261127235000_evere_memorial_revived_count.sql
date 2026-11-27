alter table public.evere_home_memorial add column revived_count integer check (revived_count >= 0);
grant update (revived_count) on public.evere_home_memorial to authenticated;
