alter table public.evere_series add column series_number integer;

with numbered as (
    select s.id, row_number() over (order by min(a.published_at) nulls last, s.title, s.id)::integer as number
    from public.evere_series s
    left join public.evere_articles a on a.series_id = s.id and a.status = 'published'
    group by s.id, s.title
)
update public.evere_series s set series_number = n.number from numbered n where s.id = n.id;

alter table public.evere_series
    alter column series_number set not null,
    alter column series_number add generated always as identity,
    add constraint evere_series_number_key unique (series_number);

select pg_catalog.setval(
    pg_catalog.pg_get_serial_sequence('public.evere_series', 'series_number'),
    coalesce(max(series_number), 1),
    count(*) > 0
) from public.evere_series;

create index if not exists evere_series_published_articles_idx on public.evere_articles
    (series_id, published_at desc, id) where status = 'published' and series_id is not null;
