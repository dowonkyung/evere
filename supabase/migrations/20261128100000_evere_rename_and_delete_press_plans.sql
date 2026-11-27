alter table public.evere_press_pages
    drop constraint evere_press_pages_issue_fkey,
    add constraint evere_press_pages_issue_fkey foreign key (issue)
        references public.evere_press_issues(issue) on update cascade on delete cascade;

create function public.evere_save_press_plan(p_issue integer, p_new_issue integer, p_expected_date date,
    p_expected_count integer, p_date date, p_pages integer, p_remove integer[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if not coalesce(evere_private.member_role() in ('owner','director'), false) then
        raise exception '발행 계획을 수정할 권한이 없습니다.' using errcode = '42501';
    end if;
    if p_new_issue is null or p_new_issue < 0 then raise exception '올바른 호수를 입력해 주세요.'; end if;
    perform public.evere_update_press_issue(p_issue, p_expected_date, p_expected_count, p_date, p_pages, p_remove);
    if p_new_issue = p_issue then return; end if;
    if exists (select 1 from public.evere_press_issues where issue = p_issue and is_extra) then
        raise exception '호외는 호수를 변경할 수 없습니다.';
    end if;
    perform 1 from public.evere_press_pages where issue = p_issue order by page for update;
    if exists (select 1 from public.evere_press_work where issue = p_issue and expires_at > now()) then
        raise exception '편집 중인 면이 있습니다. 편집이 끝난 뒤 호수를 변경해 주세요.';
    end if;
    update public.evere_press_issues set issue = p_new_issue where issue = p_issue;
exception when unique_violation then
    raise exception '이미 등록된 호수입니다.' using errcode = '23505';
end;
$$;

create function public.evere_delete_press_plan(p_issue integer, p_expected_date date, p_expected_count integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare
    plan public.evere_press_issues%rowtype;
begin
    if not coalesce(evere_private.member_role() in ('owner','director'), false) then
        raise exception '발행 계획을 삭제할 권한이 없습니다.' using errcode = '42501';
    end if;
    select * into plan from public.evere_press_issues where issue = p_issue for update;
    if not found or plan.page_count is distinct from p_expected_count or plan.publication_date is distinct from p_expected_date then
        raise exception '발행 계획이 변경됐습니다. 새로고침 후 다시 열어 주세요.';
    end if;
    perform 1 from public.evere_press_pages where issue = p_issue order by page for update;
    if exists (select 1 from public.evere_press_work where issue = p_issue and expires_at > now()) then
        raise exception '편집 중인 면이 있습니다. 편집이 끝난 뒤 발행 계획을 삭제해 주세요.';
    end if;
    delete from public.evere_press_issues where issue = p_issue;
end;
$$;
revoke all on function public.evere_save_press_plan(integer,integer,date,integer,date,integer,integer[]) from public, anon;
revoke all on function public.evere_delete_press_plan(integer,date,integer) from public, anon;
grant execute on function public.evere_save_press_plan(integer,integer,date,integer,date,integer,integer[]) to authenticated;
grant execute on function public.evere_delete_press_plan(integer,date,integer) to authenticated;
