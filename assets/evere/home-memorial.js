import { supabase } from './supabase.js';

export async function loadMemorialCount() {
    const { data, error } = await supabase.from('evere_home_memorial')
        .select('victim_count').eq('id', true).single();
    if (error) throw error;
    return data.victim_count;
}

const display = document.querySelector('[data-home-memorial-count]');
if (display) {
    loadMemorialCount().then(count => {
        if (Number.isInteger(count) && count >= 0) display.textContent = count.toLocaleString('ko-KR') + '명';
    }).catch(() => {
        display.textContent = '집계 확인 중';
    });
}
