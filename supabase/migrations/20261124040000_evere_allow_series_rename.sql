grant update (title) on public.evere_series to authenticated;

create policy evere_series_editor_rename on public.evere_series
for update to authenticated
using (
    (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head'
        and sector = any ((select evere_private.current_sectors())::public.evere_sector[]))
)
with check (
    (select evere_private.member_role()) in ('owner', 'director')
    or ((select evere_private.member_role()) = 'department_head'
        and sector = any ((select evere_private.current_sectors())::public.evere_sector[]))
);
