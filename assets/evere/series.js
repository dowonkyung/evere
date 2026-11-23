export function seriesLink(sector, id, number) {
    if (Number.isSafeInteger(number) && number > 0) return '/series/articles/' + number;
    return new URL('../../' + sector + '/?series=' + encodeURIComponent(id), import.meta.url).href;
}

export function requestedSeries() {
    const id = new URLSearchParams(location.search).get('series');
    return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '') ? id : '';
}

export async function seriesFor(sector) {
    if (!sector) return [];
    const { supabase } = await import('./supabase.js');
    const { data, error } = await supabase.from('evere_series').select('id,title,series_number').eq('sector', sector).order('title');
    if (error) throw error;
    return data;
}

export async function recentSeries(sector) {
    const { supabase } = await import('./supabase.js');
    const { data, error } = await supabase.rpc('evere_recent_series', { news_sector: sector });
    if (error) throw error;
    if (data.length !== 3) return [];
    const { data: numbered, error: numberError } = await supabase.from('evere_series')
        .select('id,series_number').in('id', data.map(({ id }) => id));
    const keys = new Map((numbered || []).map(({ id, series_number }) => [id, series_number]));
    return data.map(({ id, title }) => ({
        id, title, href: seriesLink(sector, id, numberError ? null : keys.get(id)),
    }));
}
