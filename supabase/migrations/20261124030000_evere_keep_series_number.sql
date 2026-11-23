create function evere_private.keep_series_number()
returns trigger language plpgsql set search_path = ''
as $$
begin
    if new.series_number is distinct from old.series_number then
        raise exception 'Assigned series numbers cannot change' using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger evere_keep_series_number
before update on public.evere_series
for each row execute function evere_private.keep_series_number();
