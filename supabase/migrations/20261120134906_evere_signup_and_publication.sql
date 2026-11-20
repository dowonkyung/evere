-- Keep a municipal membership application from being opened by an Evere-only signup.
create or replace trigger municipal_membership_created
after insert on auth.users for each row
when ((new.raw_user_meta_data ->> 'evere_app') is distinct from 'evere')
execute function public.create_membership_request();

alter table public.evere_articles
    add column category text,
    add column byline_names text[] not null default '{}';
alter table public.evere_articles add constraint evere_article_category_check check (
    category is null or category = any(case sector
        when 'opinion' then array['editorial','column','contributions']
        when 'wiki' then array['general','council','informal-groups','chair']
        when 'virtual-nations' then array['general','nations','virtual-united-nations','hangaker-wolbon','kaguk-diguk']
        when 'politics' then array['general','president','assembly','legal','north-korea','foreign-defense','administration']
        when 'economy' then array['general','policy','industry','finance','real-estate','technology','automotive']
        when 'society' then array['general','incidents','justice','education','labor','health-welfare','environment']
        when 'international' then array['general','china','japan','asia-oceania','americas','europe','middle-east-africa']
        when 'health' then array['general','living','obituaries','gukjim']
        when 'sports' then array['general','baseball','football','basketball-volleyball','golf']
        when 'culture' then array['general','k-pop','religion','nam-gwang-hui','film-music','arts']
    end)
);
create index evere_articles_category_public_idx on public.evere_articles (sector, category, published_at desc)
where status = 'published';
grant insert (category), update (category) on public.evere_articles to authenticated;

create function evere_private.snapshot_byline()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    select array_agg(m.display_name order by b.pos) into new.byline_names
    from unnest(new.byline) with ordinality b(id, pos)
    join public.evere_members m on m.id = b.id;
    return new;
end;
$$;
revoke execute on function evere_private.snapshot_byline() from public, anon, authenticated;
create trigger evere_snapshot_byline before insert or update of byline on public.evere_articles
for each row execute function evere_private.snapshot_byline();

alter table public.evere_comments add column author_name text not null default '';
create function evere_private.snapshot_comment_author()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
    select m.display_name into new.author_name from public.evere_members m where m.id = new.author_id;
    return new;
end;
$$;
revoke execute on function evere_private.snapshot_comment_author() from public, anon, authenticated;
create trigger evere_snapshot_comment_author before insert on public.evere_comments
for each row execute function evere_private.snapshot_comment_author();
