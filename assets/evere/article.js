import { mountArticleAudio } from './article-audio-player.js?v=1';
import { showReporterCards } from './reporter-cards.js?v=reporter-links-1';
import { collectionButton } from './reader-collections.js';
import { articlePageTitle, setArticleTitle } from './article-label.js';
import { articlePath, articleNumberFromURL } from './routes.js?v=wiki-culture-1';
import { renderBody, renderPhotos, photoBucket } from './article-content.js?v=paragraph-breaks-2';
import { seriesFor, seriesLink } from './series.js?v=numbered-link-1';
import { supabase } from './supabase.js';
import { sectors } from './article-taxonomy.js?v=wiki-culture-1';

const ui = (id) => document.getElementById(id);
let articleId = new URLSearchParams(location.search).get('id');
const articleNumber = articleNumberFromURL();
let currentArticle = null;
const form = ui('comment-form');
const commentMore = ui('comments-more');
const pageSize = 5;
const articleTimestampFormat = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul',
});
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
let shownComments = 0;

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

for (const button of document.querySelectorAll('[data-reader-size], [data-reader-theme]')) {
    button.addEventListener('click', () => {
        const { readerSize, readerTheme } = button.dataset;
        if (readerSize) ui('published-article').dataset.textSize = readerSize;
        else {
            for (const element of [document.body, ui('evere-header')]) {
                if (readerTheme === 'light') delete element.dataset.readerPalette;
                else element.dataset.readerPalette = readerTheme;
            }
        }
        for (const option of button.parentElement.children) {
            option.setAttribute('aria-pressed', String(option === button));
        }
    });
}
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
for (const panel of toolPanels) {
    panel.querySelector('.reader-panel-close').addEventListener('click', () => {
        panel.open = false;
        panel.querySelector('summary').focus();
    });
}
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

const commentOrder = ui('comment-order');
const orderSummary = commentOrder.querySelector('summary');
let oldestFirst = false;
const commentRefresh = ui('comments-refresh');
const relativeCommentTime = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
let commentRequest = 0;

function commentTime(date) {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes >= 0 && minutes < 1) return '방금 전';
    if (minutes >= 1 && minutes < 60) return relativeCommentTime.format(-minutes, 'minute');
    if (minutes >= 60 && minutes < 1440) return relativeCommentTime.format(-Math.floor(minutes / 60), 'hour');
    return dateFormat.format(date);
}

async function commentsAt(newOffset) {
    const request = ++commentRequest;
    if (newOffset === 0) commentMore.hidden = true;
    const ascending = oldestFirst;
    const response = await supabase.from('evere_comments').select('author_name,body,created_at', { count: 'exact' })
        .eq('article_id', articleId).order('created_at', { ascending }).order('id', { ascending })
        .range(newOffset, newOffset + pageSize - 1);
    if (request !== commentRequest) return;
    const rows = checked(response);
    ui('comment-list-status').textContent = '';
    ui('article-comment-count').textContent = response.count ?? '';
    shownComments = newOffset + rows.length;
    const remaining = Math.max(0, (response.count ?? shownComments) - shownComments);
    ui('comments-remaining').textContent = remaining.toLocaleString('ko-KR');
    commentMore.hidden = remaining === 0;
    const items = rows.map((row) => {
        const item = document.createElement('li');
        const meta = document.createElement('p');
        meta.className = 'comment-meta';
        const author = document.createElement('strong');
        author.textContent = row.author_name || '이브레 회원';
        const date = new Date(row.created_at);
        const time = document.createElement('time');
        time.dateTime = row.created_at;
        time.title = dateFormat.format(date);
        time.textContent = commentTime(date);
        meta.append(author, time);
        const body = document.createElement('p');
        body.className = 'comment-body';
        body.textContent = row.body;
        item.append(meta, body);
        return item;
    });
    const list = ui('comments');
    if (newOffset === 0) list.replaceChildren(...items);
    else list.append(...items);
    if (shownComments === 0) {
        const empty = document.createElement('li');
        empty.className = 'comment-empty';
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
        ui('comment-list-status').textContent = '댓글을 불러오지 못했습니다.';
    } finally {
        button.disabled = false;
    }
}

commentRefresh.addEventListener('click', () => navigateComments(commentRefresh, 0));
const orderButtons = [...commentOrder.querySelectorAll('[data-comment-order]')];
for (const button of orderButtons) {
    button.addEventListener('click', () => {
        const ascending = button.dataset.commentOrder === 'oldest';
        commentOrder.open = false;
        orderSummary.focus();
        if (ascending === oldestFirst) return;
        oldestFirst = ascending;
        commentOrder.querySelector('.comment-order-label').textContent = button.textContent;
        for (const option of orderButtons) option.setAttribute('aria-pressed', String(option === button));
        void navigateComments(commentRefresh, 0);
    });
}
commentOrder.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !commentOrder.open) return;
    commentOrder.open = false;
    orderSummary.focus();
});
document.addEventListener('click', event => {
    if (!commentOrder.contains(event.target)) commentOrder.open = false;
});
commentMore.addEventListener('click', () => navigateComments(commentMore, shownComments));
const commentInput = form.elements.comment;
const commentSubmit = form.querySelector('[type="submit"]');
let commentSaving = false;
function updateCommentLength() {
    ui('comment-length').textContent = commentInput.value.length;
    commentSubmit.disabled = commentSaving || !commentInput.value.trim();
}
commentInput.addEventListener('input', updateCommentLength);

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (commentSubmit.disabled) return;
    commentSaving = true;
    updateCommentLength();
    try {
        checked(await supabase.from('evere_comments').insert({ article_id: articleId, body: form.elements.comment.value.trim() }));
        form.reset();
        ui('status').textContent = '댓글을 등록했습니다.';
        await commentsAt(0);
    } catch {
        ui('status').textContent = '댓글을 등록하지 못했습니다. 계정과 입력 내용을 확인해 주세요.';
    } finally {
        commentSaving = false;
        updateCommentLength();
    }
});

function splitPlainParagraphs(body) {
    for (const paragraph of body.querySelectorAll('p, div')) {
        if (paragraph.querySelector('p, div, figure, ul, ol, blockquote') || !/\S[ \t]*\r?\n\s*\S/.test(paragraph.textContent)) continue;
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const parts = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            for (const match of node.data.matchAll(/\r\n?|\n/g)) {
                range.setEnd(node, match.index);
                parts.push(range.cloneContents());
                range.collapse(false);
                range.setStart(node, match.index + match[0].length);
            }
        }
        if (!parts.length) continue;
        range.setEnd(paragraph, paragraph.childNodes.length);
        parts.push(range.cloneContents());
        paragraph.replaceWith(...parts.filter(part => part.textContent.trim()).map(part => {
            const block = paragraph.cloneNode(false);
            block.append(part);
            return block;
        }));
    }
}

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
    mountArticleAudio(ui('article-listen'), data.audio_path);
    const canonicalURL = new URL(articlePath(data), location.origin);
    history.replaceState(null, '', canonicalURL.pathname + location.hash);
    const canonical = document.querySelector('link[rel="canonical"]') || document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = canonicalURL.href;
    document.head.append(canonical);
    const shareURL = encodeURIComponent(canonicalURL.href);
    ui('article-facebook').href = 'https://www.facebook.com/sharer/sharer.php?u=' + shareURL;
    ui('article-x').href = 'https://twitter.com/intent/tweet?url=' + shareURL + '&text=' + encodeURIComponent(data.title);
    ui('article-email').href = 'mailto:?subject=' + encodeURIComponent(data.title) + '&body=' + encodeURIComponent(canonicalURL.href);
    const title = articlePageTitle(data.title, data.article_label);
    document.title = title + ' | 이브레';
    const sectionLink = document.createElement('a');
    sectionLink.href = '/' + data.sector + '/';
    sectionLink.textContent = sectors[data.sector];
    ui('sector').replaceChildren(sectionLink);
    ui('title').textContent = title;
    const subtitle = data.subtitle?.trim() || '';
    ui('subtitle').textContent = subtitle;
    ui('editor-subtitle').hidden = !subtitle;
    const body = ui('body');
    renderBody(body, data, { legacyLineBreaks: true });
    splitPlainParagraphs(body);
    while (body.firstElementChild?.matches('p, div')) {
        const paragraph = body.firstElementChild;
        if (paragraph.textContent.trim() || paragraph.querySelector('figure[data-photo]')) break;
        paragraph.remove();
    }
    void renderPhotos(ui('article-photos'), data.photo_paths, body).catch(() => {});
    const firstPublished = data.first_published_at || data.published_at;
    if (firstPublished) {
        const writeTime = (time, label, value) => {
            time.dateTime = value;
            time.textContent = label + ' ' + articleTimestampFormat.format(new Date(value)).replaceAll('-', '.');
        };
        ui('published-time').hidden = false;
        if (data.modified_at) {
            writeTime(ui('first-published-time'), '입력', firstPublished);
            writeTime(ui('modified-time'), '수정', data.modified_at);
            const toggle = ui('article-time-toggle');
            const firstRow = ui('article-time-first-row');
            toggle.hidden = false;
            toggle.onclick = () => {
                const expanded = toggle.getAttribute('aria-expanded') === 'false';
                toggle.setAttribute('aria-expanded', String(expanded));
                firstRow.setAttribute('aria-hidden', String(!expanded));
            };
        } else {
            const time = ui('first-published-only');
            writeTime(time, '입력', firstPublished);
            time.hidden = false;
        }
    }
    const names = data.byline_names;
    const reporterCount = data.byline?.length || 0;
    const byline = ui('byline');
    const reporterName = (name) => /\s기자$/.test(name) ? name : name + ' 기자';
    let titles = new Map();
    const reporterLinks = new Map();
    const setByline = () => {
        byline.replaceChildren(...names.map((name, index) => {
            const person = document.createElement('span');
            const title = titles.get(index + 1);
            const label = index >= reporterCount ? name : (title ? name + ' ' + title : reporterName(name));
            const href = reporterLinks.get(data.byline?.[index]);
            if (href) {
                const link = document.createElement('a');
                link.href = href;
                link.textContent = label;
                person.append(link);
            } else {
                person.textContent = label;
            }
            return person;
        }));
    };
    setByline();
    if (reporterCount) void Promise.resolve(supabase.rpc('evere_article_byline_positions', { target_article: data.id }))
        .then(({ data: positions, error }) => {
            if (error || !positions?.length) return;
            titles = new Map(positions.map(row => [row.byline_index, row.position_title.trim()]));
            setByline();
        }).catch(() => {});
    if (reporterCount) void Promise.resolve(supabase.rpc('evere_article_reporter_cards', { target_article: data.id }))
        .then(({ data: reporters, error }) => {
            if (error || !reporters?.length) return;
            for (const reporter of reporters) {
                if (reporter.reporter_number) reporterLinks.set(reporter.reporter_id, '/reporter/' + reporter.reporter_number);
            }
            setByline();
            return showReporterCards(reporters);
        }).catch(() => {});
    ui('status').replaceChildren();
    ui('published-article').hidden = false;
    void collectionButton(ui('article-bookmark'), 'bookmarks', data.id, ['북마크', '북마크']).catch(() => {});

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
        const { data: profile } = await supabase.from('evere_members').select('id,display_name')
            .eq('id', sessionData.session.user.id).maybeSingle();
        ui('comment-writer').textContent = profile?.display_name || '';
        form.hidden = !profile;
        ui('comment-sign-in').hidden = Boolean(profile);
    }
}

async function readArticle() {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            let query = supabase.from('evere_articles').select('id,article_number,title,article_label,subtitle,body,body_html,photo_paths,audio_path,sector,series_id,byline,byline_names,published_at,first_published_at,modified_at')
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

