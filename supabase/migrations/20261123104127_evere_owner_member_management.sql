create function public.evere_owner_members()
returns table (id uuid, display_name text, role public.evere_role, sectors public.evere_sector[],
               email text, joined_at timestamptz, last_sign_in_at timestamptz, position_title text, avatar_path text)
language plpgsql stable security definer set search_path = ''
as $$
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
    order by m.display_name, m.id;
end;
$$;
create function public.evere_owner_save_member(target uuid, new_name text, new_position text,
    new_role public.evere_role, new_sectors public.evere_sector[])
returns void language plpgsql security definer set search_path = ''
as $$
declare
    old_role public.evere_role;
begin
    if evere_private.member_role() is distinct from 'owner'::public.evere_role then
        raise exception 'Owner access required' using errcode = '42501';
    end if;
    select role into strict old_role from public.evere_members where id = target for update;
    if new_role is null or (old_role = 'owner' and new_role <> 'owner')
        or (old_role <> 'owner' and new_role = 'owner') then
        raise exception 'Cannot change owner role' using errcode = '42501';
    end if;
    update public.evere_members set display_name = pg_catalog.btrim(new_name), role = new_role,
        sectors = case when new_role = 'department_head' then new_sectors else '{}'::public.evere_sector[] end
        where id = target;
    insert into public.evere_member_profiles (member_id, position_title)
        values (target, pg_catalog.btrim(new_position))
        on conflict (member_id) do update set position_title = excluded.position_title;
end;
$$;
revoke all on function public.evere_owner_members() from public, anon, authenticated;
revoke all on function public.evere_owner_save_member(uuid,text,text,public.evere_role,public.evere_sector[]) from public, anon, authenticated;
grant execute on function public.evere_owner_members() to authenticated;
grant execute on function public.evere_owner_save_member(uuid,text,text,public.evere_role,public.evere_sector[]) to authenticated;
create policy evere_avatar_owner_read on storage.objects for select to authenticated
using (bucket_id = 'evere-avatars' and (select evere_private.member_role()) = 'owner'
    and exists (select 1 from public.evere_members m where storage.objects.name = m.id::text || '/profile'));
notify pgrst, 'reload schema';
