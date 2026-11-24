create function public.evere_reporter_subscriber_count(target_number bigint)
returns bigint language sql stable security definer set search_path = ''
as $$
    select count(*)
    from public.evere_reporter_profile(target_number) reporter
    join public.evere_reporter_follows follow on follow.reporter_id = reporter.reporter_id
    join public.evere_members member on member.id = follow.member_id and member.removed_at is null;
$$;
revoke all on function public.evere_reporter_subscriber_count(bigint) from public, anon, authenticated;
grant execute on function public.evere_reporter_subscriber_count(bigint) to anon, authenticated;
notify pgrst, 'reload schema';
