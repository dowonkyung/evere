create table public.evere_issues (
    id uuid primary key default gen_random_uuid(),
    issue_number integer generated always as identity unique,
    title text not null unique check (title = btrim(title) and char_length(title) between 1 and 100)
);
alter table public.evere_articles add column issue_id uuid references public.evere_issues(id);
create index evere_articles_issue_id_idx on public.evere_articles(issue_id) where issue_id is not null;
alter table public.evere_issues enable row level security;
grant select on public.evere_issues to anon, authenticated;
grant insert (title) on public.evere_issues to authenticated;
grant usage on sequence public.evere_issues_issue_number_seq to authenticated;
grant insert (issue_id), update (issue_id) on public.evere_articles to authenticated;

create policy evere_issues_public_read on public.evere_issues for select to anon, authenticated
using (exists (select 1 from public.evere_articles a where a.issue_id = evere_issues.id and a.status = 'published'));
create policy evere_issues_newsroom_read on public.evere_issues for select to authenticated
using ((select evere_private.member_role()) in ('owner', 'director', 'department_head', 'reporter'));
create policy evere_issues_newsroom_create on public.evere_issues for insert to authenticated
with check ((select evere_private.member_role()) in ('owner', 'director'));

create function evere_private.save_author_article_issue(target uuid, new_title text, new_subtitle text,
    new_body text, new_body_html text, new_photo_paths text[], next_state text, new_print_issue integer,
    new_print_page integer, new_audio_path text, new_byline uuid[], new_article_label text, new_issue_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    perform public.evere_save_author_article(target, new_title, new_subtitle, new_body, new_body_html,
        new_photo_paths, next_state, new_print_issue, new_print_page, new_audio_path, new_byline, new_article_label);
    update public.evere_articles set issue_id = new_issue_id where id = target and created_by = auth.uid();
end;
$$;

create function public.evere_save_author_article_issue(target uuid, new_title text, new_subtitle text,
    new_body text, new_body_html text, new_photo_paths text[], next_state text, new_print_issue integer,
    new_print_page integer, new_audio_path text, new_byline uuid[], new_article_label text, new_issue_id uuid)
returns void language sql set search_path = ''
as $$
    select evere_private.save_author_article_issue(target, new_title, new_subtitle, new_body, new_body_html,
        new_photo_paths, next_state, new_print_issue, new_print_page, new_audio_path, new_byline, new_article_label, new_issue_id);
$$;
revoke all on function evere_private.save_author_article_issue(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text,uuid) from public, anon;
revoke all on function public.evere_save_author_article_issue(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text,uuid) from public, anon;
grant execute on function evere_private.save_author_article_issue(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text,uuid) to authenticated;
grant execute on function public.evere_save_author_article_issue(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text,uuid) to authenticated;
