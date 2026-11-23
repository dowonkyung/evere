import { supabase } from './supabase.js';

export function issueUrl(input) {
    const value = input.trim();
    if (!value || /[\s\\]/.test(value) || !/^(https?:\/\/|\/(?!\/))/i.test(value)) return null;
    try {
        const url = new URL(value, location.origin);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export async function loadHomeIssues() {
    const { data, error } = await supabase.from('evere_home_issues').select('position,label,url').order('position');
    if (error) throw error;
    return data;
}

export function renderHomeIssues(list, items) {
    list.replaceChildren(...items.map(({ label, url }) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.textContent = label;
        const href = issueUrl(url);
        if (href) link.href = href;
        item.append(link);
        return item;
    }));
}

const list = document.querySelector('[data-home-issues]');
if (list) void loadHomeIssues().then((items) => renderHomeIssues(list, items)).catch(() => {});
