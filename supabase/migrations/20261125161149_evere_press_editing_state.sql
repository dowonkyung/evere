
create table public.evere_press_work (
  issue integer not null,
  page integer not null,
  editor_id uuid,
  editor_name text,
  lease uuid,
  expires_at timestamptz,
  finalized_at timestamptz,
  primary key(issue,page),
  foreign key(issue,page) references public.evere_press_pages(issue,page)
);
alter table public.evere_press_work enable row level security;
revoke all on public.evere_press_work from anon, authenticated;
grant select(issue,page,editor_id,editor_name,expires_at,finalized_at) on public.evere_press_work to authenticated;
create policy press_work_read on public.evere_press_work for select to authenticated
  using ((select evere_private.member_role()) in ('owner','director','department_head','reporter'));

create function evere_private.press_work_change(p_issue integer,p_page integer,p_action text,p_lease uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  member_name text;
  role_name public.evere_role := evere_private.member_role();
  state public.evere_press_work%rowtype;
  token uuid;
begin
  if actor is null or role_name is null or role_name not in ('owner','director','department_head','reporter') then
    raise exception '조판 권한이 없습니다.' using errcode='42501';
  end if;
  perform 1 from public.evere_press_pages where issue=p_issue and page=p_page for update;
  if not found then raise exception '지면을 찾을 수 없습니다.'; end if;
  select * into state from public.evere_press_work where issue=p_issue and page=p_page;
  if p_action = 'claim' then
    if state.finalized_at is not null then raise exception '강판된 면입니다.'; end if;
    if state.expires_at > now() then raise exception '% 님이 편집 중입니다.', state.editor_name; end if;
    select display_name into member_name from public.evere_members where id=actor;
    token := gen_random_uuid();
    insert into public.evere_press_work(issue,page,editor_id,editor_name,lease,expires_at)
      values(p_issue,p_page,actor,coalesce(member_name,'편집자'),token,now()+interval '3 minutes')
    on conflict(issue,page) do update set editor_id=excluded.editor_id, editor_name=excluded.editor_name,
        lease=excluded.lease, expires_at=excluded.expires_at;
    return token;
  elsif p_action in ('renew','release') then
    if state.editor_id is distinct from actor or state.lease is distinct from p_lease or p_lease is null then
      raise exception '이 면의 편집 잠금이 만료되었습니다.';
    end if;
    if p_action='renew' then
      update public.evere_press_work set expires_at=now()+interval '3 minutes' where issue=p_issue and page=p_page;
    else
      delete from public.evere_press_work where issue=p_issue and page=p_page;
    end if;
    return p_lease;
  elsif p_action in ('finalize','reopen') and role_name in ('owner','director') then
    if state.expires_at > now() then raise exception '편집 중인 면은 강판할 수 없습니다.'; end if;
    if p_action='finalize' then
      if not exists(select 1 from public.evere_press_pages where issue=p_issue and page=p_page and revision>0 and preview_path is not null) then
        raise exception '편집본을 저장한 후 강판할 수 있습니다.';
      end if;
      insert into public.evere_press_work(issue,page,finalized_at) values(p_issue,p_page,now())
        on conflict(issue,page) do update set editor_id=null,editor_name=null,lease=null,expires_at=null,finalized_at=now();
    else
      delete from public.evere_press_work where issue=p_issue and page=p_page and finalized_at is not null;
    end if;
    return null;
  end if;
  raise exception '조판 권한이 없습니다.' using errcode='42501';
end;
$$;
revoke all on function evere_private.press_work_change(integer,integer,text,uuid) from public, anon;
grant execute on function evere_private.press_work_change(integer,integer,text,uuid) to authenticated;
create function public.evere_press_work_change(p_issue integer,p_page integer,p_action text,p_lease uuid default null)
returns uuid language sql security invoker set search_path = '' as $$
  select evere_private.press_work_change(p_issue,p_page,p_action,p_lease);
$$;
revoke all on function public.evere_press_work_change(integer,integer,text,uuid) from public, anon;
grant execute on function public.evere_press_work_change(integer,integer,text,uuid) to authenticated;

alter policy press_page_update on public.evere_press_pages to authenticated
  using (exists (select 1 from public.evere_press_work w
    where w.issue=evere_press_pages.issue and w.page=evere_press_pages.page
      and w.editor_id=(select auth.uid()) and w.expires_at>now() and w.finalized_at is null));
