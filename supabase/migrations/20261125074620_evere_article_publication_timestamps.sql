alter table public.evere_articles
    add column first_published_at timestamptz,
    add column modified_at timestamptz;

create function evere_private.track_article_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.first_published_at := case when new.status = 'published' then coalesce(new.published_at, now()) end;
        new.modified_at := null;
        return new;
    end if;

    new.first_published_at := coalesce(
        old.first_published_at,
        case when old.status = 'published' then old.published_at end,
        case when new.status = 'published' then coalesce(new.published_at, now()) end
    );
    new.modified_at := old.modified_at;
    if coalesce(old.first_published_at, case when old.status = 'published' then old.published_at end) is not null
       and (new.title, new.subtitle, new.body, new.body_html, new.article_label, new.sector,
            new.category, new.series_id, new.byline, new.guest_byline, new.guest_byline_positions,
            new.photo_paths, new.print_issue, new.print_page)
       is distinct from
           (old.title, old.subtitle, old.body, old.body_html, old.article_label, old.sector,
            old.category, old.series_id, old.byline, old.guest_byline, old.guest_byline_positions,
            old.photo_paths, old.print_issue, old.print_page) then
        new.modified_at := clock_timestamp();
    end if;
    return new;
end;
$$;

create trigger evere_zz_track_article_timestamps
before insert or update on public.evere_articles
for each row execute function evere_private.track_article_timestamps();
