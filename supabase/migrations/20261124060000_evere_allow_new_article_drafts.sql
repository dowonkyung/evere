grant insert (editorial_state) on public.evere_articles to authenticated;

alter policy evere_article_submit on public.evere_articles with check (
    created_by = (select auth.uid())
    and status = 'pending'
    and editorial_state in ('draft', 'complete')
    and (select evere_private.member_role()) is not null
);
