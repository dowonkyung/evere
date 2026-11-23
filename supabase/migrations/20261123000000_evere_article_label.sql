alter table public.evere_articles
    add column article_label text not null default ''
        check (article_label in ('', 'exclusive', 'breaking'));

grant insert (article_label), update (article_label) on public.evere_articles to authenticated;
