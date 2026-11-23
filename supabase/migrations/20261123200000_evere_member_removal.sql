alter table public.evere_members add column if not exists removed_at timestamptz;

create or replace function evere_private.member_role()
returns public.evere_role language sql stable security definer set search_path = ''
as $$ select role from public.evere_members where id = (select auth.uid()) and removed_at is null; $$;

CREATE OR REPLACE FUNCTION public.evere_owner_members()
 RETURNS TABLE(id uuid, display_name text, role evere_role, sectors evere_sector[], email text, joined_at timestamp with time zone, last_sign_in_at timestamp with time zone, position_title text, avatar_path text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    if evere_private.member_role() is distinct from 'owner'::public.evere_role then
        raise exception 'Owner access required' using errcode = '42501';
    end if;
    return query
    select m.id, m.display_name, m.role, m.sectors, u.email::text, u.created_at, u.last_sign_in_at,
           coalesce(p.position_title, ''), o.name
    from public.evere_members m join auth.users u on u.id = m.id
    left join public.evere_member_profiles p on p.member_id = m.id
    left join storage.objects o on o.bucket_id = 'evere-avatars' and o.name = m.id::text || '/profile'
    where m.removed_at is null
    order by m.display_name, m.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION evere_private.register_member(member_name text)
 RETURNS evere_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
    caller uuid := auth.uid();
    member public.evere_members;
begin
    if caller is null or not exists (
        select 1 from auth.users as u where u.id = caller and u.email_confirmed_at is not null
    ) then
        raise exception 'An email-confirmed account is required' using errcode = '42501';
    end if;

    select * into member from public.evere_members where id = caller;
    if found then
        if member.removed_at is not null then
            raise exception 'Evere membership was removed' using errcode = 'EV001';
        end if;
        return member;
    end if;

    insert into public.evere_members (id, display_name, role)
    values (
        caller, trim(member_name),
        case when exists (select 1 from evere_private.owner_account where user_id = caller)
             then 'owner'::public.evere_role else 'citizen'::public.evere_role end
    )
    on conflict (id) do nothing;
    select * into strict member from public.evere_members where id = caller;
    return member;
end;
$function$
;

create or replace function public.evere_owner_remove_member(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
    if (select evere_private.member_role()) is distinct from 'owner'::public.evere_role then
        raise exception 'Owner access required' using errcode = '42501';
    end if;
    update public.evere_members set removed_at = now()
    where id = target and role <> 'owner' and removed_at is null;
    if not found then raise exception 'Active non-owner member required' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.evere_owner_remove_member(uuid) from public, anon;
grant execute on function public.evere_owner_remove_member(uuid) to authenticated;

create policy evere_active_member_directory on public.evere_members as restrictive for select to authenticated
using (removed_at is null or id = (select auth.uid()));
create policy evere_active_profile on public.evere_member_profiles as restrictive for all to authenticated
using ((select evere_private.member_role()) is not null)
with check ((select evere_private.member_role()) is not null);
alter policy evere_editorial_read on public.evere_articles using (
    (select evere_private.member_role()) is not null and
    (created_by = (select auth.uid()) or
     (select evere_private.member_role()) in ('owner', 'director') or
     ((select evere_private.member_role()) = 'department_head' and
       sector = any ((select evere_private.current_sectors())::public.evere_sector[])))
);
