import { supabase } from './supabase.js';
import { photoBucket, readPhotoCaption } from './article-content.js?v=photo-options-1';

const storedPath = /^[a-f\d-]{36}\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i;

async function findPhotos(query, active) {
    const matches = new Map();
    const batch = 40;
    const token = query.toLocaleLowerCase('ko-KR');
    // Escape text as stored HTML before searching the shortlist. Verify the actual caption below.
    const carrier = document.createElement('span');
    carrier.textContent = query;
    const escaped = carrier.innerHTML.replace(/[\\%_]/g, char => '\\' + char);
    for (let offset = 0; active(); offset += batch) {
        let request = supabase.from('evere_articles').select('id,title,body_html,photo_paths').neq('photo_paths', '{}');
        if (query) request = request.ilike('body_html', '%' + escaped + '%');
        const { data, error } = await request.order('created_at', { ascending: false })
            .order('id').range(offset, offset + batch - 1);
        if (error) throw error;
        for (const entry of data || []) {
            const template = document.createElement('template');
            template.innerHTML = entry.body_html || '';
            const paths = new Set(entry.photo_paths || []);
            const figures = new Map([...template.content.querySelectorAll('figure[data-photo]')]
                .map(figure => [figure.dataset.photo, figure]));
            for (const path of paths) {
                if (!storedPath.test(path) || matches.has(path)) continue;
                const figure = figures.get(path);
                const caption = figure ? readPhotoCaption(figure) : { captionTitle: '', caption: '' };
                if (![caption.captionTitle, caption.caption].some(value => value.toLocaleLowerCase('ko-KR').includes(token))) continue;
                matches.set(path, { path, ...caption, articleTitle: entry.title });
                if (matches.size === 20) return [...matches.values()];
            }
        }
        if (!data || data.length < batch) break;
    }
    return [...matches.values()];
}

export function connectPhotoLibrary(panel, onSelect) {
    const query = panel.querySelector('[data-photo-query]');
    const results = panel.querySelector('[data-photo-results]');
    const status = panel.querySelector('[data-photo-library-status]');
    let version = 0;
    async function search() {
        const request = ++version;
        const active = () => panel.isConnected && request === version;
        const term = query.value.trim();
        results.replaceChildren();
        status.textContent = '기존 사진을 불러오는 중입니다.';
        try {
            const rows = await findPhotos(term, active);
            if (!active()) return;
            const signed = rows.length ? await photoBucket.createSignedUrls(rows.map(row => row.path), 600) : null;
            if (!active()) return;
            if (signed?.error) throw signed.error;
            const urls = new Map((signed?.data || []).map(({ path, signedUrl }) => [path, signedUrl]));
            for (const row of rows) {
                const url = urls.get(row.path);
                if (!url) continue;
                const button = document.createElement('button');
                button.type = 'button';
                const label = row.captionTitle || row.caption || row.articleTitle || '기존 사진';
                button.title = label;
                button.setAttribute('aria-label', label + ' 불러오기');
                const image = document.createElement('img');
                image.src = url;
                image.loading = 'lazy';
                image.alt = '';
                image.addEventListener('error', () => { image.src = '/assets/evere/media-placeholder.svg'; }, { once: true });
                button.append(image);
                button.addEventListener('click', () => void onSelect({ ...row, url }));
                results.append(button);
            }
            status.textContent = results.childElementCount ? '' : '검색 결과가 없습니다.';
        } catch {
            if (active()) status.textContent = '사진을 불러오지 못했습니다. 다시 시도해 주세요.';
        }
    }
    panel.querySelector('[data-photo-search]').addEventListener('click', () => void search());
    query.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        void search();
    });
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        if (!version) void search();
    });
    observer.observe(panel);
    return () => { version++; observer.disconnect(); };
}
