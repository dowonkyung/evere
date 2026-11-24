alter table public.evere_articles
    add column print_issue integer check (print_issue > 0),
    add column print_page integer check (print_page > 0);
grant select (print_issue, print_page), insert (print_issue, print_page), update (print_issue, print_page)
on public.evere_articles to authenticated;

CREATE OR REPLACE FUNCTION evere_private.save_author_draft(target uuid, new_title text, new_subtitle text, new_body text, new_body_html text, new_photo_paths text[], next_state text, new_print_issue integer, new_print_page integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
    if auth.uid() is null or evere_private.member_role() is null then
        raise exception 'Active newsroom membership required' using errcode = '42501';
    end if;
    if next_state is null or next_state not in ('draft', 'complete') then
        raise exception 'Invalid author state' using errcode = '42501';
    end if;

    if new_title is null or pg_catalog.char_length(pg_catalog.btrim(new_title)) not between 1 and 200
       or new_subtitle is null or pg_catalog.char_length(new_subtitle) > 500
       or new_body is null or pg_catalog.char_length(pg_catalog.btrim(new_body)) not between 1 and 50000
       or new_body_html is null or pg_catalog.octet_length(new_body_html) > 400000
       or new_photo_paths is null then
        raise exception 'Invalid article content' using errcode = '22023';
    end if;

    update public.evere_articles
       set title = new_title, subtitle = new_subtitle, body = new_body,
           body_html = new_body_html, photo_paths = new_photo_paths, editorial_state = next_state,
           print_issue = new_print_issue, print_page = new_print_page
     where id = target and created_by = auth.uid() and editorial_state = 'draft'
       and status = 'pending';
    if not found then
        raise exception 'Draft no longer editable by this author' using errcode = 'EV002';
    end if;
end;
$function$
;
revoke all on function evere_private.save_author_draft(uuid,text,text,text,text,text[],text,integer,integer) from public, anon, authenticated;
grant execute on function evere_private.save_author_draft(uuid,text,text,text,text,text[],text,integer,integer) to authenticated;

create function public.evere_save_author_draft(target uuid, new_title text, new_subtitle text, new_body text,
    new_body_html text, new_photo_paths text[], next_state text, new_print_issue integer, new_print_page integer)
returns void language sql security invoker set search_path = ''
as $$
    select evere_private.save_author_draft(target, new_title, new_subtitle, new_body, new_body_html,
        new_photo_paths, next_state, new_print_issue, new_print_page);
$$;
revoke all on function public.evere_save_author_draft(uuid,text,text,text,text,text[],text,integer,integer) from public, anon, authenticated;
grant execute on function public.evere_save_author_draft(uuid,text,text,text,text,text[],text,integer,integer) to authenticated;
notify pgrst, 'reload schema';
