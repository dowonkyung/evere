create function public.evere_owner_member_profiles()
returns table (member_id uuid, bio text, reporter_email text)
language sql stable security definer set search_path = ''
as $$
    select m.id, coalesce(p.bio, ''), coalesce(p.reporter_email, '')
    from public.evere_owner_members() m
    left join public.evere_member_profiles p on p.member_id = m.id
    order by m.id;
$$;

create function public.evere_owner_save_member(target uuid, new_name text, new_position text, new_role public.evere_role, new_sectors public.evere_sector[], new_bio text, new_reporter_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
    perform public.evere_owner_save_member(target, new_name, new_position, new_role, new_sectors);
    update public.evere_member_profiles
    set bio = pg_catalog.btrim(new_bio), reporter_email = pg_catalog.btrim(new_reporter_email)
    where member_id = target;
end;
$$;

revoke all on function public.evere_owner_member_profiles() from public, anon;
revoke all on function public.evere_owner_save_member(uuid,text,text,public.evere_role,public.evere_sector[],text,text) from public, anon;
grant execute on function public.evere_owner_member_profiles() to authenticated;
grant execute on function public.evere_owner_save_member(uuid,text,text,public.evere_role,public.evere_sector[],text,text) to authenticated;
notify pgrst, 'reload schema';
