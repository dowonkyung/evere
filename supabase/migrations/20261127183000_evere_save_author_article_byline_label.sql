create function evere_private.save_author_article(target uuid, new_title text, new_subtitle text, new_body text, new_body_html text, new_photo_paths text[], next_state text, new_print_issue integer, new_print_page integer, new_audio_path text, new_byline uuid[], new_article_label text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
    if new_article_label is null or new_article_label not in ('', 'breaking', 'exclusive')
       or new_byline is null then
        raise exception 'Invalid article label or byline' using errcode = '22023';
    end if;

    perform evere_private.save_author_draft_audio(target, new_title, new_subtitle, new_body,
        new_body_html, new_photo_paths, next_state, new_print_issue, new_print_page, new_audio_path);

    if evere_private.member_role() = 'reporter'
       and not (auth.uid() = any(new_byline))
       and exists (
           select 1 from public.evere_articles a where a.id = target
             and a.byline is distinct from new_byline
             and not (
               cardinality(new_byline) = 0 and cardinality(a.guest_byline) = 0
               and coalesce((a.sector = 'opinion' and a.category = 'editorial')
                            or (a.sector = 'health' and a.category = 'obituaries'), false)
             )
       ) then
        raise exception 'Reporters must appear in their own byline' using errcode = '42501';
    end if;

    update public.evere_articles
       set byline = new_byline, article_label = new_article_label
     where id = target and created_by = auth.uid();
end;
$$;

create function public.evere_save_author_article(target uuid, new_title text, new_subtitle text, new_body text, new_body_html text, new_photo_paths text[], next_state text, new_print_issue integer, new_print_page integer, new_audio_path text, new_byline uuid[], new_article_label text)
returns void language sql set search_path = ''
as $$
    select evere_private.save_author_article(target, new_title, new_subtitle, new_body,
        new_body_html, new_photo_paths, next_state, new_print_issue, new_print_page,
        new_audio_path, new_byline, new_article_label);
$$;

revoke all on function evere_private.save_author_article(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text) from public, anon;
revoke all on function public.evere_save_author_article(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text) from public, anon;
grant execute on function evere_private.save_author_article(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text) to authenticated;
grant execute on function public.evere_save_author_article(uuid,text,text,text,text,text[],text,integer,integer,text,uuid[],text) to authenticated;
