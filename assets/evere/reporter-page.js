import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { articleListPicture, loadArticleListPhotos } from './article-list-media.js?v=category-pages-1';
import { setArticleTitle } from './article-label.js';
import { collectionButton } from './reader-collections.js?v=subscribers-1';

const ui = id => document.getElementById(id);
const url = new URL(location.href);
const candidate = /^\/reporter\/([1-9]\d*)\/?$/.exec(url.pathname)?.[1] || url.searchParams.get('number');
const number = /^[1-9]\d*$/.test(candidate || '') ? Number(candidate) : 0;
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const pageSize = 20;
let offset = 0;
let countRequest = 0;
const numberFormat = new Intl.NumberFormat('ko-KR');

function articleRow(entry) {
    const row = document.createElement('li');
    const article = document.createElement('article');
    const copy = document.createElement('div');
    const link = document.createElement('a');
    link.href = articlePath(entry);
    setArticleTitle(link, entry.title, entry.article_label);
    const summary = document.createElement('p');
    summary.className = 'desc';
    summary.textContent = (entry.body || '').slice(0, 220);
    const date = document.createElement('p');
    date.className = 'date';
    if (entry.published_at) date.textContent = dateFormat.format(new Date(entry.published_at)).replaceAll('-', '.');
    copy.append(link, summary, date);
    article.append(articleListPicture({ photoPath: entry.photo_paths?.[0] }), copy);
    row.append(article);
    return row;
}

async function loadArticles(reporter) {
    const button = ui('reporter-load-more');
    const list = ui('reporter-articles');
    const status = ui('reporter-list-status');
    button.disabled = true;
    status.textContent = '기사를 불러오는 중입니다.';
    try {
        const { data, error } = await supabase.from('evere_articles')
            .select('article_number,title,article_label,body,photo_paths,published_at')
            .eq('status', 'published').contains('byline', [reporter]).not('article_number', 'is', null)
            .order('published_at', { ascending: false, nullsFirst: false }).order('id')
            .range(offset, offset + pageSize);
        if (error) throw error;
        list.append(...data.slice(0, pageSize).map(articleRow));
        offset += Math.min(data.length, pageSize);
        button.hidden = data.length <= pageSize;
        ui('reporter-empty').hidden = list.childElementCount > 0;
        status.textContent = '';
        void loadArticleListPhotos(list).catch(() => {});
    } catch {
        status.textContent = '기사를 불러오지 못했습니다.';
        button.hidden = false;
    } finally {
        button.disabled = false;
    }
}

async function setAvatar(path, name) {
    const avatar = ui('reporter-avatar');
    avatar.textContent = Array.from(name)[0] || '';
    if (!path) return;
    const { data } = await supabase.storage.from('evere-avatars').createSignedUrl(path, 3600);
    if (!data?.signedUrl) return;
    const image = new Image(128, 128);
    image.alt = '';
    image.addEventListener('load', () => avatar.replaceChildren(image), { once: true });
    image.src = data.signedUrl;
}

async function refreshSubscriberCount() {
    const request = ++countRequest;
    const { data, error } = await supabase.rpc('evere_reporter_subscriber_count', { target_number: number });
    if (!error && data !== null && request === countRequest) {
        ui('reporter-subscriber-count').textContent = numberFormat.format(data);
    }
}

function configureSectionHeader() {
    const header = ui('reporter-section-header');
    const profile = ui('reporter-details').querySelector('.journalist_header');
    const follow = ui('reporter-follow');
    const stickyFollow = ui('reporter-sticky-follow');
    const syncFollow = () => {
        stickyFollow.hidden = follow.hidden;
        stickyFollow.textContent = follow.textContent;
        stickyFollow.setAttribute('aria-pressed', follow.getAttribute('aria-pressed') || 'false');
        stickyFollow.disabled = follow.disabled;
    };
    new MutationObserver(syncFollow).observe(follow, { attributes: true, childList: true, characterData: true, subtree: true });
    syncFollow();
    stickyFollow.onclick = () => follow.click();
    ui('reporter-sticky-share').onclick = () => ui('reporter-share').click();

    function updateHeader() {
        const top = Number.parseFloat(getComputedStyle(header).getPropertyValue('--reporter-sticky-top')) || 0;
        header.classList.toggle('sticky_top', window.scrollY > 0 &&
            profile.getBoundingClientRect().bottom <= top + header.offsetHeight);
    }
    window.addEventListener('scroll', updateHeader, { passive: true });
    window.addEventListener('resize', updateHeader);
    updateHeader();
}

async function render() {
    if (!Number.isSafeInteger(number) || number < 1) {
        ui('reporter-status').textContent = '기자 페이지를 찾을 수 없습니다.';
        return;
    }
    url.pathname = '/reporter/' + number;
    url.searchParams.delete('number');
    if (location.href !== url.href) history.replaceState(null, '', url.href);
    const { data, error } = await supabase.rpc('evere_reporter_profile', { target_number: number }).maybeSingle();
    if (error) throw error;
    if (!data) {
        ui('reporter-status').textContent = '기자 페이지를 찾을 수 없습니다.';
        return;
    }
    document.title = data.display_name + ' | 기자 | 이브레';
    ui('reporter-name').textContent = data.display_name;
    const position = '이브레 ' + (data.position_title.trim() || '기자');
    ui('reporter-position').textContent = position;
    ui('reporter-sticky-name').textContent = data.display_name;
    ui('reporter-sticky-position').textContent = position;
    ui('reporter-bio').textContent = data.bio;
    ui('reporter-bio').hidden = !data.bio.trim();
    if (data.public_email) {
        const email = ui('reporter-email');
        email.textContent = data.public_email;
        email.href = 'mailto:' + encodeURIComponent(data.public_email).replace('%40', '@');
        ui('reporter-contact').hidden = false;
    }
    const status = ui('reporter-action-status');
    ui('reporter-share').onclick = async () => {
        try {
            if (navigator.share) await navigator.share({ title: document.title, url: location.href });
            else {
                await navigator.clipboard.writeText(location.href);
                status.textContent = '주소를 복사했습니다.';
            }
        } catch (error) {
            if (error.name !== 'AbortError') status.textContent = '주소를 공유하지 못했습니다.';
        }
    };
    ui('reporter-status').hidden = true;
    ui('reporter-details').hidden = false;
    configureSectionHeader();
    void setAvatar(data.avatar_path, data.display_name).catch(() => {});
    const refreshCount = () => void refreshSubscriberCount().catch(() => {});
    refreshCount();
    void collectionButton(ui('reporter-follow'), 'reporters', data.reporter_id, ['구독', '구독 취소'], status, refreshCount).catch(() => {});
    ui('reporter-load-more').onclick = () => void loadArticles(data.reporter_id);
    await loadArticles(data.reporter_id);
}

void render().catch(() => { ui('reporter-status').textContent = '기자 정보를 불러오지 못했습니다.'; });
