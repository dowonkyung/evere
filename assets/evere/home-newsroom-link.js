import { supabase } from './supabase.js';

const shortcut = document.querySelector('#evere-header')?.shadowRoot?.querySelector('[data-newsroom-shortcut]');
const eligible = new Set(['reporter', 'department_head', 'director', 'owner']);
let request = 0;

if (shortcut) {
    supabase.auth.onAuthStateChange((_event, session) => {
        const current = ++request;
        const id = session?.user?.id;
        if (!id) {
            shortcut.hidden = true;
            return;
        }
        setTimeout(async () => {
            try {
                const { data, error } = await supabase.from('evere_members').select('role')
                    .eq('id', id).is('removed_at', null).maybeSingle();
                if (current === request) shortcut.hidden = Boolean(error) || !eligible.has(data?.role);
            } catch {
                if (current === request) shortcut.hidden = true;
            }
        }, 0);
    });
}
