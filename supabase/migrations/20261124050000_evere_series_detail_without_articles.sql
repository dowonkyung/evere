create function public.evere_series_by_number(requested_number integer)
returns table (id uuid, title text, series_number integer)
language sql stable security definer set search_path = ''
as $$
    select s.id, s.title, s.series_number
    from public.evere_series s
    where s.series_number = requested_number;
$$;

revoke all on function public.evere_series_by_number(integer) from public;
grant execute on function public.evere_series_by_number(integer) to anon, authenticated;
