import { supabase } from './supabase.js';

export async function loadMemorialCounts() {
    const { data, error } = await supabase.from('evere_home_memorial')
        .select('victim_count,revived_count').eq('id', true).single();
    if (error) throw error;
    return data;
}

const displays = [...document.querySelectorAll('[data-home-memorial-count]')];
if (displays.length) {
    loadMemorialCounts().then(counts => {
        for (const display of displays) {
            const count = counts[display.dataset.homeMemorialCount];
            if (Number.isInteger(count) && count >= 0) display.textContent = count.toLocaleString('ko-KR') + '명';
        }
    }).catch(() => {
        for (const display of displays) display.textContent = '확인 중';
    });
}
