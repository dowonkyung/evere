lock table public.evere_articles in share row exclusive mode;

alter table public.evere_articles add column article_number bigint
    check (article_number between 1 and 9007199254740991);
alter table public.evere_articles add constraint evere_articles_article_number_key unique (article_number);

with numbered as (
    select id, row_number() over (order by coalesce(published_at, created_at), created_at, id) as number
    from public.evere_articles where status = 'published'
)
update public.evere_articles a set article_number = n.number
from numbered n where a.id = n.id;

create table evere_private.article_number_counter (
    singleton boolean primary key default true check (singleton),
    next_number bigint not null check (next_number between 1 and 9007199254740991)
);
alter table evere_private.article_number_counter enable row level security;
revoke all on evere_private.article_number_counter from public, anon, authenticated;
insert into evere_private.article_number_counter (singleton, next_number)
select true, coalesce(max(article_number), 0) + 1 from public.evere_articles;

-- A trigger-only helper owns the private counter; article writes still use existing RLS.
create function evere_private.assign_article_number()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if new.article_number is not null then
            raise exception 'Article numbers are assigned on first publication' using errcode = '23514';
        end if;
    else
        if new.id is distinct from old.id or new.article_number is distinct from old.article_number then
            raise exception 'Article identifiers cannot change' using errcode = '23514';
        end if;
    end if;
    if new.status = 'published' and new.article_number is null then
        update evere_private.article_number_counter
        set next_number = next_number + 1 where singleton = true
        returning next_number - 1 into new.article_number;
        if not found then raise exception 'Article number counter is missing'; end if;
    end if;
    return new;
end;
$$;
revoke all on function evere_private.assign_article_number() from public, anon, authenticated;
create trigger evere_10_assign_article_number
before insert or update on public.evere_articles
for each row execute function evere_private.assign_article_number();
alter table public.evere_articles add constraint evere_published_article_number
    check (status <> 'published' or article_number is not null);
notify pgrst, 'reload schema';

