create function public.evere_search_results(
    keyword text, result_kind text, search_scope text default '',
    published_from timestamptz default null, published_before timestamptz default null
)
returns table (
    id uuid, article_number bigint, title text, subtitle text, body text, published_at timestamptz,
    photo_path text, photo_order bigint, body_html text, sector public.evere_sector, category text,
    byline_names text[], relevance integer
)
language sql stable security invoker set search_path = ''
as $$
    with query as (
        select pg_catalog.lower(pg_catalog.btrim(keyword)) as term
        where pg_catalog.char_length(pg_catalog.btrim(keyword)) between 1 and 120
          and result_kind in ('articles', 'opinion', 'images')
          and search_scope in ('', 'title', 'body', 'byline', 'series')
    ), matched as (
        select a.*, case search_scope
            when 'title' then scores.title
            when 'body' then scores.body
            when 'byline' then scores.byline
            when 'series' then scores.series
            else greatest(scores.title, scores.body, scores.byline, scores.series, scores.subtitle)
        end as rank
        from public.evere_articles a
        cross join query q
        left join public.evere_series s on s.id = a.series_id
        cross join lateral (
            select
              case when pg_catalog.lower(a.title) = q.term then 6 when strpos(pg_catalog.lower(a.title), q.term) > 0 then 5 else 0 end as title,
              case when strpos(pg_catalog.lower(a.body), q.term) > 0 then 1 else 0 end as body,
              case when exists (select 1 from pg_catalog.unnest(a.byline_names) name where strpos(pg_catalog.lower(name), q.term) > 0) then 4 else 0 end as byline,
              case when strpos(pg_catalog.lower(s.title), q.term) > 0 then 4 else 0 end as series,
              case when strpos(pg_catalog.lower(a.subtitle), q.term) > 0 then 3 else 0 end as subtitle
        ) scores
        where a.status = 'published' and a.article_number is not null
          and (published_from is null or a.published_at >= published_from)
          and (published_before is null or a.published_at < published_before)
          and (
              result_kind = 'images'
              or (result_kind = 'opinion' and a.sector = 'opinion' and a.category in ('editorial','column'))
              or (result_kind = 'articles' and not coalesce(a.sector = 'opinion' and a.category in ('editorial','column'), false))
          )
    )
    select m.id, m.article_number, m.title, m.subtitle, pg_catalog.left(m.body, 400), m.published_at,
           photo.path, photo.ordinality, case when result_kind = 'images' then m.body_html end,
           m.sector, m.category, m.byline_names, m.rank
    from matched m
    cross join lateral pg_catalog.unnest(
        case when result_kind = 'images' then m.photo_paths else array[m.photo_paths[1]] end
    ) with ordinality as photo(path, ordinality)
    where m.rank > 0 and (result_kind <> 'images' or photo.path is not null);
$$;

revoke all on function public.evere_search_results(text,text,text,timestamptz,timestamptz) from public;
grant execute on function public.evere_search_results(text,text,text,timestamptz,timestamptz) to anon, authenticated;
