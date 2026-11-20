create table public.evere_series (
    id uuid primary key default gen_random_uuid(),
    sector public.evere_sector not null,
    title text not null check (title = btrim(title) and char_length(title) between 1 and 100),
    unique (id, sector)
);
create unique index evere_series_title_sector on public.evere_series (sector, lower(title));
alter table public.evere_series enable row level security;
revoke all on public.evere_series from public, anon, authenticated;
grant select on public.evere_series to anon, authenticated;
grant insert (sector, title) on public.evere_series to authenticated;

alter table public.evere_articles add column series_id uuid;
alter table public.evere_articles add constraint evere_articles_series_sector_fk
    foreign key (series_id, sector) references public.evere_series (id, sector);
grant insert (series_id), update (series_id) on public.evere_articles to authenticated;
create index evere_articles_series_idx on public.evere_articles (series_id, published_at desc)
    where series_id is not null;

create policy evere_series_staff_read on public.evere_series for select to authenticated
using ((select evere_private.member_role()) is not null);
create policy evere_series_published_read on public.evere_series for select to anon, authenticated
using (exists (select 1 from public.evere_articles a where a.series_id = evere_series.id and a.status = 'published'));
create policy evere_series_editor_create on public.evere_series for insert to authenticated
with check (
    (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head'
        and sector = any((select evere_private.current_sectors())::public.evere_sector[]))
);

create function public.evere_recent_series(news_sector public.evere_sector)
returns table (id uuid, title text, published_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
    select s.id, s.title, max(a.published_at)
    from public.evere_series s
    join public.evere_articles a on a.series_id = s.id
    where s.sector = news_sector and a.status = 'published'
    group by s.id, s.title
    order by max(a.published_at) desc, s.id
    limit 3;
$$;
revoke all on function public.evere_recent_series(public.evere_sector) from public;
grant execute on function public.evere_recent_series(public.evere_sector) to anon, authenticated;
