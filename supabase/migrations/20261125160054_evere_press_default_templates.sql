
alter policy press_page_create on public.evere_press_pages to authenticated
  with check ((select evere_private.member_role()) in ('owner','director') and revision = 0
    and preview_path is null and updated_at is null
    and source_path = case when page = 1 then 'default-templates/front.indd'
                           when page % 2 = 0 then 'default-templates/even.indd'
                           else 'default-templates/odd.indd' end
    and exists (select 1 from public.evere_press_issues i
                 where i.issue = evere_press_pages.issue and evere_press_pages.page <= i.page_count)
    and exists (select 1 from storage.objects o
                 where o.bucket_id = 'evere-press' and o.name = source_path));

create or replace function public.evere_create_press_issue(p_issue integer, p_date date, p_pages integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.evere_press_issues(issue, publication_date, page_count)
    values (p_issue, p_date, p_pages);
  insert into public.evere_press_pages(issue,page,source_path)
    select p_issue, n, case when n = 1 then 'default-templates/front.indd'
                            when n % 2 = 0 then 'default-templates/even.indd'
                            else 'default-templates/odd.indd' end
      from generate_series(1,p_pages) n;
end;
$$;

do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'evere-press'
        and name in ('default-templates/front.indd','default-templates/odd.indd','default-templates/even.indd')) <> 3 then
    raise exception 'Default print templates are missing';
  end if;
end $$;

update public.evere_press_pages
   set source_path = case when page = 1 then 'default-templates/front.indd'
                          when page % 2 = 0 then 'default-templates/even.indd'
                          else 'default-templates/odd.indd' end
 where revision = 0 and source_path is null;
