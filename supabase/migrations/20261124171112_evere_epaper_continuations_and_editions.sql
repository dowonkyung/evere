alter table public.evere_epaper_regions
 add column print_body text check (length(print_body) <= 100000),
 add column online_body text check (length(online_body) <= 100000),
 add column next_page integer,
 add column next_article bigint,
 add constraint evere_epaper_next_pair check ((next_page is null and next_article is null) or (next_page > 0 and next_article is not null and next_page <> page));
alter policy "Read published print regions" on public.evere_epaper_regions using (
 exists (select 1 from public.evere_articles a where a.article_number = evere_epaper_regions.article_number and a.status = 'published' and a.print_issue = evere_epaper_regions.issue)
);
create unique index evere_epaper_one_previous on public.evere_epaper_regions(issue,next_page,next_article) where next_page is not null;
