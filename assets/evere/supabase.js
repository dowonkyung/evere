import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

export const supabase = createClient('https://qikhxlwthbtrwbrhryex.supabase.co', 'sb_publishable_itD8ySTzc0w6VIrC3XDCHQ_l5E27u0H', {
    auth: { storageKey: 'evere-auth' },
});
