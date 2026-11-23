import { articlePageTitle, setArticleTitle } from './article-label.js';
import { articlePath, articleNumberFromURL } from './routes.js?v=direct-route-1';
import { renderBody, renderPhotos, photoBucket } from './article-content.js?v=caption-1';
import { seriesFor, seriesLink } from './series.js?v=numbered-link-1';
import { supabase } from './supabase.js';
import { sectors } from './article-taxonomy.js';

const ui = (id) => document.getElementById(id);
let articleId = new URLSearchParams(location.search).get('id');
const articleNumber = articleNumberFromURL();
let currentArticle = null;
const form = ui('comment-form');
const previous = ui('comments-previous');
const next = ui('comments-next');
const pageSize = 25;
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
let offset = 0;

function enableReadingHeader(articleTitle) {
    const host = ui('evere-header');
    const shadow = host?.shadowRoot;
    if (!shadow) return;
    const headline = shadow.querySelector('.article-header-title');
    const navigation = shadow.querySelector('.gnb-menu01');
    const progress = shadow.querySelector('.article-reading-progress');
    const article = ui('published-article');
    const title = ui('title');
    if (!headline || !navigation || !progress) return;
    headline.textContent = articleTitle;
    const actions = ui('reader-actions');
    const layout = actions.parentElement;
    const header = headline.parentElement;
    const mobile = window.matchMedia('(max-width: 1023px)');
    let scheduled = false;

    function update() {
        scheduled = false;
        const headerBottom = host.getBoundingClientRect().bottom;
        const titleBottom = title.getBoundingClientRect().bottom;
        const traveled = headerBottom - titleBottom;
        const fullDistance = traveled + article.getBoundingClientRect().bottom - window.innerHeight;
        const visible = traveled >= 0;
        const showTools = visible && mobile.matches;
        const showHeadline = visible && !mobile.matches;
        if (showTools !== header.classList.contains('article-tools-active')) {
            header.classList.toggle('article-tools-active', showTools);
            for (const panel of toolPanels) panel.open = false;
            if (showTools) {
                actions.slot = 'article-tools';
                host.append(actions);
            } else {
                actions.removeAttribute('slot');
                layout.prepend(actions);
            }
        }
        navigation.hidden = showHeadline;
        headline.hidden = !showHeadline;
        progress.hidden = !visible;
        const fraction = visible ? Math.min(1, traveled / Math.max(1, fullDistance)) : 0;
        progress.style.setProperty('--article-progress', fraction);
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(update);
    }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('pageshow', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    observer.observe(article);
    schedule();
}

ui('article-text-size').addEventListener('change', (event) => {
    ui('published-article').dataset.textSize = event.target.value;
});
const articlePage = document.querySelector('.article-page');
const theme = ui('article-theme');
theme.addEventListener('click', () => {
    const dark = articlePage.classList.toggle('reader-dark');
    theme.setAttribute('aria-pressed', String(dark));
});
ui('article-print').addEventListener('click', () => window.print());
ui('article-copy').addEventListener('click', async () => {
    if (!currentArticle) return;
    try {
        await navigator.clipboard.writeText(new URL(articlePath(currentArticle), location.origin).href);
        ui('article-share-status').textContent = '주소를 복사했습니다.';
    } catch {
        ui('article-share-status').textContent = '주소를 복사하지 못했습니다.';
    }
});
ui('article-native-share').hidden = !navigator.share;
ui('article-native-share').addEventListener('click', async () => {
    if (!currentArticle) return;
    try {
        await navigator.share({ title: currentArticle.title, url: new URL(articlePath(currentArticle), location.origin).href });
    } catch (error) {
        if (error.name !== 'AbortError') ui('article-share-status').textContent = '공유하지 못했습니다.';
    }
});
const toolPanels = [...ui('reader-actions').querySelectorAll('details')];
document.addEventListener('click', (event) => {
    for (const panel of toolPanels) if (!event.composedPath().includes(panel)) panel.open = false;
});
ui('reader-actions').addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const panel = event.target.closest('details[open]');
    if (panel) {
        panel.open = false;
        panel.querySelector('summary').focus();
    }
});

async function showTopArticles() {
    const fields = 'id,article_number,title,article_label,photo_paths';
    const [featured, recent] = await Promise.all([
        supabase.from('evere_page_slots').select('slot,evere_articles!inner(' + fields + ')')
            .eq('page', 'home').eq('category', '').eq('evere_articles.status', 'published').order('slot'),
        supabase.from('evere_articles').select(fields)
            .eq('status', 'published').neq('id', articleId)
            .order('published_at', { ascending: false, nullsFirst: false }).order('id').limit(5),
    ]);
    const entries = new Map();
    for (const row of [...(featured.data || []).map(item => item.evere_articles), ...(recent.data || [])]) {
        if (row && row.id !== articleId && !entries.has(row.id)) entries.set(row.id, row);
    }
    const rows = [...entries.values()].slice(0, 5);
    if (!rows.length) return;
    const related = ui('article-related');
    const links = rows.map((article) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = articlePath(article);
        const title = document.createElement('span');
        setArticleTitle(title, article.title, article.article_label);
        link.append(title);
        item.append(link);
        return { item, link, path: article.photo_paths?.[0] };
    });
    related.querySelector('ul').replaceChildren(...links.map(({ item }) => item));
    related.hidden = false;
    const paths = [...new Set(links.map(({ path }) => path).filter(Boolean))];
    if (!paths.length) return;
    const { data } = await photoBucket.createSignedUrls(paths, 3600);
    const urls = new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl]));
    for (const { link, path } of links) {
        if (!urls.get(path)) continue;
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = urls.get(path);
        image.addEventListener('error', () => image.remove(), { once: true });
        link.append(image);
    }
}

function checked(response) {
    if (response.error) throw response.error;
    return response.data;
}

async function commentsAt(newOffset) {
    const response = await supabase.from('evere_comments').select('author_name,body,created_at', { count: 'exact' })
        .eq('article_id', articleId).order('created_at', { ascending: false }).order('id')
        .range(newOffset, newOffset + pageSize);
    const rows = checked(response);
    ui('article-comment-count').textContent = response.count ?? '';
    offset = newOffset;
    previous.disabled = offset === 0;
    next.disabled = rows.length <= pageSize;
    ui('comments').replaceChildren(...rows.slice(0, pageSize).map((row) => {
        const item = document.createElement('li');
        const meta = document.createElement('p');
        meta.className = 'comment-meta';
        meta.textContent = (row.author_name || '이브레 회원') + ' · ' + dateFormat.format(new Date(row.created_at));
        const body = document.createElement('p');
        body.className = 'comment-body';
        body.textContent = row.body;
        item.append(meta, body);
        return item;
    }));
    if (!rows.length) {
        const empty = document.createElement('li');
        empty.textContent = '아직 댓글이 없습니다.';
        ui('comments').append(empty);
    }
}

async function navigateComments(button, newOffset) {
    button.disabled = true;
    try {
        await commentsAt(newOffset);
    } catch {
        button.disabled = false;
        ui('status').textContent = '댓글을 불러오지 못했습니다.';
    }
}

previous.addEventListener('click', () => navigateComments(previous, Math.max(0, offset - pageSize)));
next.addEventListener('click', () => navigateComments(next, offset + pageSize));
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    try {
        checked(await supabase.from('evere_comments').insert({ article_id: articleId, body: form.elements.comment.value.trim() }));
        form.reset();
        ui('status').textContent = '댓글을 등록했습니다.';
        await commentsAt(0);
    } catch {
        ui('status').textContent = '댓글을 등록하지 못했습니다. 계정과 입력 내용을 확인해 주세요.';
    } finally {
        submit.disabled = false;
    }
});

async function render() {
    if (!articleNumber && (!articleId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(articleId))) {
        ui('status').textContent = '기사를 찾을 수 없습니다.';
        return;
    }
    const data = await readArticle();
    if (!data) {
        ui('status').textContent = '게시된 기사를 찾을 수 없습니다.';
        return;
    }
    articleId = data.id;
    currentArticle = data;
    const canonicalURL = new URL(articlePath(data), location.origin);
    history.replaceState(null, '', canonicalURL.pathname + location.hash);
    const canonical = document.querySelector('link[rel="canonical"]') || document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = canonicalURL.href;
    document.head.append(canonical);
    ui('article-email').href = 'mailto:?subject=' + encodeURIComponent(data.title) + '&body=' + encodeURIComponent(canonicalURL.href);
    const title = articlePageTitle(data.title, data.article_label);
    document.title = title + ' | 이브레';
    const sectionLink = document.createElement('a');
    sectionLink.href = '/' + data.sector + '/';
    sectionLink.textContent = sectors[data.sector];
    ui('sector').replaceChildren(sectionLink);
    ui('title').textContent = title;
    ui('subtitle').textContent = data.subtitle;
    ui('editor-subtitle').hidden = !data.subtitle?.trim();
    renderBody(ui('body'), data);
    void renderPhotos(ui('article-photos'), data.photo_paths, ui('body')).catch(() => {});
    if (data.published_at) {
        const time = ui('published-time');
        time.dateTime = data.published_at;
        time.textContent = '입력 ' + dateFormat.format(new Date(data.published_at));
    }
    const names = data.byline_names;
    const byline = ui('byline');
    const reporterName = (name) => /\s기자$/.test(name) ? name : name + ' 기자';
    byline.textContent = names.map(reporterName).join(', ');
    if (names.length) void Promise.resolve(supabase.rpc('evere_article_byline_positions', { target_article: data.id }))
        .then(({ data: positions, error }) => {
            if (error || !positions?.length) return;
            const titles = new Map(positions.map(row => [row.byline_index, row.position_title.trim()]));
            byline.textContent = names.map((name, index) => {
                const title = titles.get(index + 1);
                return title ? name + ' ' + title : reporterName(name);
            }).join(', ');
        }).catch(() => {});
    ui('status').replaceChildren();
    ui('published-article').hidden = false;
    ui('reader-actions').hidden = false;
    // Optional reading controls must never turn a displayed article into a load failure.
    try { enableReadingHeader(title); } catch (error) { console.warn('Reading header unavailable', error); }
    void showTopArticles().catch(() => {});
    if (data.series_id) void seriesFor(data.sector).then((rows) => {
        const selected = rows.find(({ id }) => id === data.series_id);
        if (!selected) return;
        const link = document.createElement('a');
        link.className = 'reader-series-link';
        link.href = seriesLink(data.sector, selected.id, selected.series_number);
        link.textContent = selected.title;
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const arrow = document.createElementNS(svgNamespace, 'svg');
        for (const [name, value] of Object.entries({
            width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none',
            'aria-hidden': 'true', focusable: 'false',
        })) arrow.setAttribute(name, value);
        const path = document.createElementNS(svgNamespace, 'path');
        for (const [name, value] of Object.entries({
            d: 'M6.5 3.5L11.5 8L6.5 12.5', stroke: 'currentColor', 'stroke-width': '1.5',
            'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        })) path.setAttribute(name, value);
        arrow.append(path);
        link.append(arrow);
        ui('sector').append(link);
    }).catch(() => {});
    ui('comments-section').hidden = false;
    void commentsAt(0).catch(() => {
        const message = document.createElement('li');
        message.textContent = '댓글을 불러오지 못했습니다.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '댓글 다시 불러오기';
        retry.addEventListener('click', () => navigateComments(retry, 0));
        message.append(retry);
        ui('comments').replaceChildren(message);
    });
    void updateCommentSession().catch(() => {});
}

async function updateCommentSession() {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
        const { data: profile } = await supabase.from('evere_members').select('id')
            .eq('id', sessionData.session.user.id).maybeSingle();
        form.hidden = !profile;
        ui('comment-sign-in').hidden = Boolean(profile);
    }
}

async function readArticle() {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            let query = supabase.from('evere_articles').select('id,article_number,title,article_label,subtitle,body,body_html,photo_paths,sector,series_id,byline_names,published_at')
                .eq('status', 'published');
            query = articleNumber ? query.eq('article_number', articleNumber) : query.eq('id', articleId);
            const response = await query.maybeSingle();
            if (!response.error) return response.data;
            const error = Object.assign(new Error(response.error.message), response.error, { status: response.status });
            throw error;
        } catch (error) {
            // Retry transport failures and temporary server errors, not permissions or invalid queries.
            const retryable = !error.status || error.status >= 500 || error.status === 408 || error.status === 429;
            if (!retryable || attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
    }
}

async function loadArticle() {
    try {
        await render();
    } catch (error) {
        console.error('Article load failed', error);
        const status = ui('status');
        status.textContent = '기사를 불러오지 못했습니다. ';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '다시 불러오기';
        retry.addEventListener('click', () => {
            retry.disabled = true;
            status.textContent = '기사를 불러오는 중입니다.';
            void loadArticle();
        });
        status.append(retry);
    }
}
void loadArticle();

