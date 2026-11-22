alter table public.evere_articles
    add column editorial_state text not null default 'complete'
    check (editorial_state in ('draft', 'complete', 'revising', 'desked', 'released'));

update public.evere_articles set editorial_state = 'released' where status = 'published';

grant update (editorial_state) on public.evere_articles to authenticated;

create function evere_private.sync_editorial_state()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if new.status = 'published' then new.editorial_state := 'released'; end if;
    elsif new.editorial_state is distinct from old.editorial_state then
        new.status := (case when new.editorial_state = 'released' then 'published' else 'pending' end)::public.evere_article_status;
    elsif new.status is distinct from old.status then
        new.editorial_state := case when new.status = 'published' then 'released' else 'complete' end;
    end if;
    return new;
end;
$$;

-- PostgreSQL runs BEFORE triggers in name order. Publication timestamps are set by evere_validate_article.
create trigger evere_00_sync_editorial_state before insert or update on public.evere_articles
for each row execute function evere_private.sync_editorial_state();
revoke execute on function evere_private.sync_editorial_state() from public, anon, authenticated;

alter table public.evere_articles add constraint evere_articles_editorial_publication
    check ((editorial_state = 'released') = (status = 'published'));
