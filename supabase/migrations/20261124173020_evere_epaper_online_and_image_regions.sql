alter table public.evere_epaper_regions
    add column online_article_number bigint references public.evere_articles(article_number) on delete set null;
create table public.evere_epaper_image_regions (
    id uuid primary key,
    issue integer not null check (issue > 0),
    page integer not null check (page > 0),
    points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 4 and 64),
    png_path text not null
);
create index evere_epaper_image_regions_edition on public.evere_epaper_image_regions(issue,page);
alter table public.evere_epaper_image_regions enable row level security;
grant select on public.evere_epaper_image_regions to anon, authenticated;
grant insert, update on public.evere_epaper_image_regions to authenticated;
create policy "Read public print image regions" on public.evere_epaper_image_regions for select to anon, authenticated using (true);
create policy "Owner adds print image regions" on public.evere_epaper_image_regions for insert to authenticated with check (
    exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
create policy "Owner edits print image regions" on public.evere_epaper_image_regions for update to authenticated using (
    exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
) with check (
    exists (select 1 from public.evere_members where id = (select auth.uid()) and role = 'owner')
);
