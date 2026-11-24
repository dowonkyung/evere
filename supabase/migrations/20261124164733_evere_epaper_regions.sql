create table public.evere_epaper_regions (
 article_number bigint not null references public.evere_articles(article_number) on delete cascade,
 issue integer not null check (issue > 0),
 page integer not null check (page > 0),
 points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 4 and 64),
 primary key (issue,page,article_number)
);
alter table public.evere_epaper_regions enable row level security;
grant select on public.evere_epaper_regions to anon, authenticated;
grant insert, update on public.evere_epaper_regions to authenticated;
create policy "Read published print regions" on public.evere_epaper_regions for select to anon, authenticated using (
 exists (select 1 from public.evere_articles a where a.article_number = evere_epaper_regions.article_number and a.status = 'published' and a.print_issue = issue and a.print_page = page)
);
create policy "Owner adds print regions" on public.evere_epaper_regions for insert to authenticated with check (
 exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
create policy "Owner edits print regions" on public.evere_epaper_regions for update to authenticated using (
 exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
) with check (
 exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
