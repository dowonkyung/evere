create extension if not exists pg_cron;
create extension if not exists http with schema extensions;

create table evere_private.pages_dispatch_queue (
    id bigint generated always as identity primary key,
    next_attempt_at timestamptz not null default now()
);
alter table evere_private.pages_dispatch_queue enable row level security;
revoke all on table evere_private.pages_dispatch_queue from public, anon, authenticated;

create or replace function evere_private.dispatch_pages_on_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.status = 'published' and new.article_number is not null then
        if tg_op = 'INSERT' or old.status is distinct from new.status then
            insert into evere_private.pages_dispatch_queue default values;
        end if;
    end if;
    return new;
end;
$$;

create function evere_private.process_pages_dispatch_queue()
returns void
language plpgsql
set search_path = ''
as $$
declare
    jobs bigint[];
    dispatch_token text;
    result_status integer;
begin
    select array_agg(ready.id) into jobs
      from (select id from evere_private.pages_dispatch_queue where next_attempt_at <= now()
            order by id limit 100) ready;
    if jobs is null then return; end if;

    select pg_catalog.btrim(secret.decrypted_secret) into dispatch_token
      from vault.decrypted_secrets secret where secret.name = 'evere_github_pages_dispatch_token';
    if nullif(dispatch_token, '') is null then return; end if;

    begin
        perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
        select response.status into result_status
          from extensions.http((
              'POST',
              'https://api.github.com/repos/dowonkyung/evere/actions/workflows/publish-pages.yml/dispatches',
              array[extensions.http_header('Authorization', 'Bearer ' || dispatch_token),
                    extensions.http_header('Accept', 'application/vnd.github+json'),
                    extensions.http_header('User-Agent', 'Evere-Pages-Publisher')],
              'application/json',
              '{"ref":"main"}'
          )::extensions.http_request) response;
    exception when others then
        raise warning 'Evere Pages dispatch failed (SQLSTATE %)', sqlstate;
    end;

    if result_status between 200 and 299 then
        delete from evere_private.pages_dispatch_queue where id = any(jobs);
    else
        if result_status is not null then
            raise warning 'Evere Pages dispatch failed (HTTP %)', result_status;
        end if;
        update evere_private.pages_dispatch_queue set next_attempt_at = now() + interval '1 minute'
          where id = any(jobs);
    end if;
end;
$$;

revoke all on function evere_private.process_pages_dispatch_queue() from public, anon, authenticated;

select cron.schedule('evere-pages-dispatch', '5 seconds', 'select evere_private.process_pages_dispatch_queue()');
