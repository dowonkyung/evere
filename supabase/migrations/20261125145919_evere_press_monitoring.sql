
create table public.evere_press_issues (
  issue integer primary key check (issue >= 0),
  publication_date date not null,
  page_count integer not null check (page_count between 1 and 200)
);
create table public.evere_press_pages (
  issue integer not null references public.evere_press_issues(issue),
  page integer not null check (page between 1 and 200),
  revision integer not null default 0,
  source_path text,
  preview_path text,
  updated_at timestamptz,
  primary key (issue, page)
);
alter table public.evere_press_issues enable row level security;
alter table public.evere_press_pages enable row level security;
revoke all on public.evere_press_issues, public.evere_press_pages from anon, authenticated;
grant select, insert on public.evere_press_issues to authenticated;
grant select, insert, update on public.evere_press_pages to authenticated;
create policy press_issue_read on public.evere_press_issues for select to authenticated
  using ((select evere_private.member_role()) in ('owner','director','department_head','reporter'));
create policy press_issue_create on public.evere_press_issues for insert to authenticated
  with check ((select evere_private.member_role()) in ('owner','director'));
create policy press_page_read on public.evere_press_pages for select to authenticated
  using ((select evere_private.member_role()) in ('owner','director','department_head','reporter'));
create policy press_page_create on public.evere_press_pages for insert to authenticated
  with check ((select evere_private.member_role()) in ('owner','director') and revision = 0
    and source_path is null and preview_path is null and updated_at is null
    and exists (select 1 from public.evere_press_issues i where i.issue = evere_press_pages.issue and evere_press_pages.page <= i.page_count));
create policy press_page_update on public.evere_press_pages for update to authenticated
  using ((select evere_private.member_role()) in ('owner','director','department_head','reporter'))
  with check ((select evere_private.member_role()) in ('owner','director','department_head','reporter')
    and source_path like (select auth.uid())::text || '/' || issue || '/' || page || '/%.indd'
    and exists (select 1 from storage.objects o where o.bucket_id = 'evere-press' and o.name = source_path)
    and (preview_path is null or (
      preview_path = regexp_replace(source_path, '\.indd$', '.jpg')
      and exists (select 1 from storage.objects o where o.bucket_id = 'evere-press' and o.name = preview_path)
    )));
revoke update on public.evere_press_pages from authenticated;
grant update (revision, source_path, preview_path, updated_at) on public.evere_press_pages to authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('evere-press','evere-press',false,52428800,array['application/octet-stream','image/jpeg']);
create policy press_file_read on storage.objects for select to authenticated
  using (bucket_id = 'evere-press' and (select evere_private.member_role()) in ('owner','director','department_head','reporter'));
create policy press_file_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'evere-press'
    and (select evere_private.member_role()) in ('owner','director','department_head','reporter')
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.extension(name) in ('indd','jpg'));
create function public.evere_create_press_issue(p_issue integer, p_date date, p_pages integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.evere_press_issues(issue, publication_date, page_count) values (p_issue, p_date, p_pages);
  insert into public.evere_press_pages(issue,page) select p_issue, n from generate_series(1,p_pages) n;
end;
$$;
revoke all on function public.evere_create_press_issue(integer,date,integer) from public, anon;
grant execute on function public.evere_create_press_issue(integer,date,integer) to authenticated;
