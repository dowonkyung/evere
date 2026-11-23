create function public.evere_article_byline_positions(target_article uuid)
returns table (byline_index integer, position_title text)
language sql stable security definer set search_path = ''
as $$
    select author.ordinality::integer, profile.position_title
    from public.evere_articles article
    cross join lateral unnest(article.byline) with ordinality as author(member_id, ordinality)
    join public.evere_member_profiles profile on profile.member_id = author.member_id
    where article.id = target_article and article.status = 'published'
      and pg_catalog.btrim(profile.position_title) <> '';
$$;
revoke all on function public.evere_article_byline_positions(uuid) from public, anon, authenticated;
grant execute on function public.evere_article_byline_positions(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
