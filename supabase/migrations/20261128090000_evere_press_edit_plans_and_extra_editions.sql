alter table public.evere_press_issues add column is_extra boolean not null default false;
create sequence evere_private.press_extra_issue_seq as integer start with 1000000000;

alter table public.evere_press_work
    drop constraint evere_press_work_issue_page_fkey,
    add constraint evere_press_work_issue_page_fkey foreign key (issue, page)
        references public.evere_press_pages(issue, page) on update cascade on delete cascade;

create function public.evere_create_extra_press_issue(p_date date, p_pages integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
    new_issue integer;
begin
    if not coalesce(evere_private.member_role() in ('owner','director'), false) then
        raise exception '발행 계획을 등록할 권한이 없습니다.' using errcode = '42501';
    end if;
    loop
        new_issue := nextval('evere_private.press_extra_issue_seq');
        begin
            perform public.evere_create_press_issue(new_issue, p_date, p_pages);
            exit;
        exception when unique_violation then
            if not exists (select 1 from public.evere_press_issues where issue = new_issue) then raise; end if;
        end;
    end loop;
    update public.evere_press_issues set is_extra = true where issue = new_issue;
    return new_issue;
end;
$$;

create function public.evere_update_press_issue(p_issue integer, p_expected_date date, p_expected_count integer,
    p_date date, p_pages integer, p_remove integer[])
returns void language plpgsql security definer set search_path = ''
as $$
declare
    plan public.evere_press_issues%rowtype;
    removed integer[] := coalesce(p_remove, '{}'::integer[]);
    old_page integer;
    next_page integer := 0;
begin
    if not coalesce(evere_private.member_role() in ('owner','director'), false) then
        raise exception '발행 계획을 수정할 권한이 없습니다.' using errcode = '42501';
    end if;
    select * into plan from public.evere_press_issues where issue = p_issue for update;
    if not found or plan.page_count is distinct from p_expected_count or plan.publication_date is distinct from p_expected_date then
        raise exception '발행 계획이 변경됐습니다. 새로고침 후 다시 열어 주세요.';
    end if;
    if p_date is null or p_pages is null or p_pages not between 1 and 200 then
        raise exception '발행일과 1~200 사이의 면수를 입력해 주세요.';
    end if;
    if cardinality(removed) <> greatest(0, plan.page_count - p_pages)
       or cardinality(removed) <> (select count(distinct page) from public.evere_press_pages
                                  where issue = p_issue and page = any(removed)) then
        raise exception '줄어드는 면수만큼 삭제할 면을 정확히 선택해 주세요.';
    end if;

    if p_pages < plan.page_count then
        perform 1 from public.evere_press_pages where issue = p_issue order by page for update;
        if exists (select 1 from public.evere_press_work where issue = p_issue and expires_at > now()) then
            raise exception '편집 중인 면이 있습니다. 편집이 끝난 뒤 면수를 줄여 주세요.';
        end if;
        delete from public.evere_press_pages where issue = p_issue and page = any(removed);
        for old_page in select page from public.evere_press_pages where issue = p_issue order by page loop
            next_page := next_page + 1;
            if next_page <> old_page then
                update public.evere_press_pages
                   set page = next_page,
                       source_path = case when revision = 0 and source_path like 'default-templates/%' then
                           case when next_page = 1 then 'default-templates/front.indd'
                                when next_page % 2 = 0 then 'default-templates/even.indd'
                                else 'default-templates/odd.indd' end
                           else source_path end
                 where issue = p_issue and page = old_page;
            end if;
        end loop;
    elsif p_pages > plan.page_count then
        insert into public.evere_press_pages(issue,page,source_path)
        select p_issue, n, case when n % 2 = 0 then 'default-templates/even.indd'
                                else 'default-templates/odd.indd' end
          from generate_series(plan.page_count + 1,p_pages) n;
    end if;
    update public.evere_press_issues set publication_date = p_date, page_count = p_pages where issue = p_issue;
end;
$$;

revoke all on function public.evere_create_extra_press_issue(date,integer) from public, anon;
revoke all on function public.evere_update_press_issue(integer,date,integer,date,integer,integer[]) from public, anon;
grant execute on function public.evere_create_extra_press_issue(date,integer) to authenticated;
grant execute on function public.evere_update_press_issue(integer,date,integer,date,integer,integer[]) to authenticated;
