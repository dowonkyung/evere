create extension if not exists pg_net with schema extensions;

revoke all on table net.http_request_queue from public, anon, authenticated;

create function evere_private.dispatch_pages_on_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    dispatch_token text;
begin
    if new.status <> 'published' or new.article_number is null then
        return new;
    end if;
    if tg_op = 'UPDATE' and old.status = 'published' then
        return new;
    end if;

    select pg_catalog.btrim(secret.decrypted_secret)
      into dispatch_token
      from vault.decrypted_secrets secret
     where secret.name = 'evere_github_pages_dispatch_token';

    if nullif(dispatch_token, '') is null then
        return new;
    end if;

    perform net.http_post(
        url := 'https://api.github.com/repos/dowonkyung/evere/actions/workflows/publish-pages.yml/dispatches',
        body := '{"ref":"main"}'::jsonb,
        headers := pg_catalog.jsonb_build_object(
            'Authorization', 'Bearer ' || dispatch_token,
            'Accept', 'application/vnd.github+json',
            'Content-Type', 'application/json',
            'User-Agent', 'Evere-Pages-Publisher'
        ),
        timeout_milliseconds := 10000
    );
    return new;
exception when others then
    raise warning 'Evere Pages dispatch could not be queued (SQLSTATE %)', sqlstate;
    return new;
end;
$$;

revoke all on function evere_private.dispatch_pages_on_publication() from public, anon, authenticated;

create trigger evere_dispatch_pages_on_publication
after insert or update of status, editorial_state on public.evere_articles
for each row execute function evere_private.dispatch_pages_on_publication();
