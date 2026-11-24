import { supabase } from './supabase.js';
import { photoBucket, readPhotoCaption } from './article-content.js?v=photo-options-1';

const storedPath = /^[a-f\d-]{36}\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i;

const pinnedTitle = '이브레 속보(CG)';
const initialCount = 6;
const moreCount = 10;
const batchSize = 24;
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

function searchState(term) {
    const carrier = document.createElement('span');
    carrier.textContent = term;
    const escaped = carrier.innerHTML.replace(/[\\%_]/g, char => '\\' + char);
    return { term, escaped, token: term.toLocaleLowerCase('ko-KR'), offset: 0,
        seen: new Set(), pending: [], exhausted: false, busy: false, pinLoaded: false };
}

async function fillPhotos(state, count, active, exactTitle = '') {
    while (active() && !state.exhausted && state.pending.length < count) {
        let request = supabase.from('evere_articles')
            .select('id,title,body_html,photo_paths,published_at')
            .neq('photo_paths', '{}');
        if (state.term) request = request.ilike('body_html', '%' + state.escaped + '%');
        const { data, error } = await request.order('published_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false }).order('id')
            .range(state.offset, state.offset + batchSize - 1);
        if (error) throw error;
        if (!active()) return;
        for (const entry of data || []) {
            const template = document.createElement('template');
            template.innerHTML = entry.body_html || '';
            const figures = new Map([...template.content.querySelectorAll('figure[data-photo]')]
                .map(figure => [figure.dataset.photo, figure]));
            for (const path of entry.photo_paths || []) {
                if (!storedPath.test(path) || state.seen.has(path)) continue;
                const figure = figures.get(path);
                const caption = figure ? readPhotoCaption(figure) : { captionTitle: '', caption: '' };
                if (exactTitle && caption.captionTitle.trim() !== exactTitle) continue;
                if (![caption.captionTitle, caption.caption].some(value => value.toLocaleLowerCase('ko-KR').includes(state.token))) continue;
                state.seen.add(path);
                state.pending.push({ path, ...caption, articleTitle: entry.title, publishedAt: entry.published_at });
            }
        }
        state.offset += batchSize;
        state.exhausted = !data || data.length < batchSize;
    }
}

function photoCard(row, url, onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    const label = row.captionTitle || row.articleTitle || '기존 사진';
    const date = row.publishedAt ? dateFormat.format(new Date(row.publishedAt)) : '미출고';
    button.setAttribute('aria-label', label + ', ' + date + ', 불러오기');
    const image = document.createElement('img');
    image.src = url;
    image.loading = 'lazy';
    image.alt = '';
    image.addEventListener('error', () => { image.src = '/assets/evere/media-placeholder.svg'; }, { once: true });
    const overlay = document.createElement('span');
    overlay.className = 'photo-library-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = label;
    const posted = document.createElement('span');
    posted.textContent = date;
    overlay.append(title, posted);
    button.append(image, overlay);
    button.addEventListener('click', () => void onSelect({ ...row, url }));
    return button;
}

export function connectPhotoLibrary(panel, onSelect) {
    const query = panel.querySelector('[data-photo-query]');
    const results = panel.querySelector('[data-photo-results]');
    const status = panel.querySelector('[data-photo-library-status]');
    const more = panel.querySelector('[data-photo-more]');
    let state = null;
    async function appendPhotos(current, count) {
        if (!current || current.busy) return;
        const active = () => panel.isConnected && current === state;
        current.busy = true;
        more.disabled = true;
        status.textContent = '기존 사진을 불러오는 중입니다.';
        try {
            if (!current.term && !current.pinLoaded) {
                const pinSearch = searchState(pinnedTitle);
                await fillPhotos(pinSearch, 1, active, pinnedTitle);
                if (!active()) return;
                const pinned = pinSearch.pending[0];
                if (pinned) {
                    current.seen.add(pinned.path);
                    current.pending.push(pinned);
                }
                current.pinLoaded = true;
            }
            await fillPhotos(current, count + 1, active);
            if (!active()) return;
            const rows = current.pending.slice(0, count);
            const signed = rows.length ? await photoBucket.createSignedUrls(rows.map(row => row.path), 600) : null;
            if (!active()) return;
            if (signed?.error) throw signed.error;
            const urls = new Map((signed?.data || []).map(({ path, signedUrl }) => [path, signedUrl]));
            for (const row of rows) {
                const url = urls.get(row.path);
                if (url) results.append(photoCard(row, url, onSelect));
            }
            current.pending.splice(0, rows.length);
            more.hidden = !current.pending.length && current.exhausted;
            status.textContent = results.childElementCount ? '' : '검색 결과가 없습니다.';
        } catch {
            if (active()) {
                status.textContent = '사진을 불러오지 못했습니다. 다시 시도해 주세요.';
                more.hidden = false;
            }
        } finally {
            current.busy = false;
            if (active()) more.disabled = false;
        }
    }
    function search() {
        state = searchState(query.value.trim());
        results.replaceChildren();
        results.scrollTop = 0;
        more.hidden = true;
        void appendPhotos(state, initialCount);
    }
    more.addEventListener('click', () => void appendPhotos(state, moreCount));
    panel.querySelector('[data-photo-search]').addEventListener('click', search);
    query.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        search();
    });
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        if (!state) search();
    });
    observer.observe(panel);
    return () => { state = null; observer.disconnect(); };
}
