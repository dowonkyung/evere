import { supabase } from './supabase.js';

export const collections = {
    bookmarks: ['evere_bookmarks', 'article_id'],
    series: ['evere_series_follows', 'series_id'],
    reporters: ['evere_reporter_follows', 'reporter_id'],
};

export async function collectionButton(button, kind, id, labels) {
    const [table, key] = collections[kind];
    const { data: { session } } = await supabase.auth.getSession();
    let selected = false;
    const update = () => {
        const label = button.querySelector('[data-collection-label]') || button;
        label.textContent = labels[Number(selected)];
        if (label !== button) button.setAttribute('aria-label', label.textContent);
        button.setAttribute('aria-pressed', String(selected));
    };
    if (session) {
        const { data, error } = await supabase.from(table).select(key).eq(key, id).maybeSingle();
        if (error) throw error;
        selected = Boolean(data);
    }
    update();
    button.hidden = false;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    (button.closest('.reader-layout')?.querySelector('.reader-article') || button.parentElement).append(status);
    button.addEventListener('click', async () => {
        if (!session) { location.assign('/account/'); return; }
        button.disabled = true;
        status.textContent = '';
        try {
            const query = supabase.from(table);
            const { error } = await (selected ? query.delete().eq(key, id) : query.insert({ [key]: id }));
            if (error) throw error;
            selected = !selected;
            update();
        } catch {
            status.textContent = '변경하지 못했습니다. 다시 시도해 주세요.';
        } finally {
            button.disabled = false;
        }
    });
}
