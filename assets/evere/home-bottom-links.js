import { supabase } from './supabase.js';

export async function loadBottomLinks(area) {
    let query = supabase.from('evere_home_bottom_links').select('area,label,url,description').order('position');
    if (area) query = query.eq('area', area);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}
