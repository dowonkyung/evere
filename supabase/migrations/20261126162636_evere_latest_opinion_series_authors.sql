
create function public.evere_latest_opinion_series_with_authors()
returns table (series_title text, article_number bigint, title text, article_label text, body_html text, photo_paths text[], authors jsonb)
language sql stable security invoker set search_path = ''
as $$
    select picked.series_title, picked.article_number, picked.title, picked.article_label,
           picked.body_html, picked.photo_paths, coalesce(author_list.authors, '[]'::jsonb)
    from (
        select distinct on (s.id) s.title as series_title, a.article_number, a.title, a.article_label::text,
            a.body_html, a.photo_paths, a.byline, a.byline_names, a.guest_byline, a.guest_byline_positions,
            a.published_at, a.id
        from public.evere_series s
        join public.evere_articles a on a.series_id = s.id and a.sector = s.sector
        where s.sector = 'opinion' and a.status = 'published' and a.article_number is not null
        order by s.id, a.published_at desc nulls last, a.id
    ) picked
    left join lateral (
        select jsonb_agg(jsonb_build_object('name', person.name, 'position', person.position) order by person.ordinality) as authors
        from (
            select picked.byline_names[member.ordinality::int] as name,
                   coalesce(position.position_title, '기자') as position, member.ordinality
            from unnest(picked.byline) with ordinality member(id, ordinality)
            left join public.evere_article_byline_positions(picked.id) position
                   on position.byline_index = member.ordinality
            union all
            select guest.name, nullif(picked.guest_byline_positions[guest.ordinality::int], ''),
                   cardinality(picked.byline) + guest.ordinality
            from unnest(picked.guest_byline) with ordinality guest(name, ordinality)
        ) person
        where nullif(btrim(person.name), '') is not null
    ) author_list on true
    order by picked.published_at desc nulls last, picked.id;
$$;
revoke all on function public.evere_latest_opinion_series_with_authors() from public;
grant execute on function public.evere_latest_opinion_series_with_authors() to anon, authenticated;
notify pgrst, 'reload schema';
