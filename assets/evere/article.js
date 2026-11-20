import { renderBody, renderPhotos } from './article-content.js?v=inline-1';
import { seriesFor, seriesLink } from './series.js';
import { supabase } from './supabase.js';
import { sectors } from './article-taxonomy.js';

const ui = (id) => document.getElementById(id);
const articleId = new URLSearchParams(location.search).get('id');
const form = ui('comment-form');
const previous = ui('comments-previous');
const next = ui('comments-next');
const pageSize = 25;
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
let offset = 0;

function enableReadingHeader(articleTitle) {
    const host = ui('evere-header');
    const shadow = host.shadowRoot;
    const headline = shadow.querySelector('.article-header-title');
    const navigation = shadow.querySelector('.gnb-menu01');
    const progress = shadow.querySelector('.article-reading-progress');
    const article = ui('published-article');
    const title = ui('title');
    headline.textContent = articleTitle;
    let scheduled = false;

    function update() {
        scheduled = false;
        const headerBottom = host.getBoundingClientRect().bottom;
        const titleBottom = title.getBoundingClientRect().bottom;
        const traveled = headerBottom - titleBottom;
        const fullDistance = traveled + article.getBoundingClientRect().bottom - window.innerHeight;
        const visible = traveled >= 0;
        navigation.hidden = visible;
        headline.hidden = !visible;
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
ui('article-share').addEventListener('click', async () => {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('id', articleId);
    try {
        if (navigator.share) {
            await navigator.share({ title: ui('title').textContent, url: url.href });
        } else {
            await navigator.clipboard.writeText(url.href);
            ui('article-share').textContent = '복사됨';
        }
    } catch (error) {
        if (error.name !== 'AbortError') ui('status').textContent = '기사 주소를 공유하지 못했습니다.';
    }
});

async function showRelated(sector) {
    const { data, error } = await supabase.from('evere_articles').select('id,title')
        .eq('sector', sector).eq('status', 'published').neq('id', articleId)
        .order('published_at', { ascending: false }).order('id').limit(5);
    if (error || !data.length) return;
    const related = ui('article-related');
    related.querySelector('ul').replaceChildren(...data.map(({ id, title }) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = '?id=' + encodeURIComponent(id);
        link.textContent = title;
        item.append(link);
        return item;
    }));
    related.hidden = false;
}

function checked(response) {
    if (response.error) throw response.error;
    return response.data;
}

async function commentsAt(newOffset) {
    const rows = checked(await supabase.from('evere_comments').select('author_name,body,created_at')
        .eq('article_id', articleId).order('created_at', { ascending: false }).order('id')
        .range(newOffset, newOffset + pageSize));
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
    if (!articleId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(articleId)) {
        ui('status').textContent = '기사를 찾을 수 없습니다.';
        return;
    }
    const data = checked(await supabase.from('evere_articles').select('title,subtitle,body,body_html,photo_paths,sector,series_id,byline_names,published_at')
        .eq('id', articleId).eq('status', 'published').maybeSingle());
    if (!data) {
        ui('status').textContent = '게시된 기사를 찾을 수 없습니다.';
        return;
    }
    document.title = data.title + ' | 이브레';
    const sectionLink = document.createElement('a');
    sectionLink.href = '../' + data.sector + '/';
    sectionLink.textContent = sectors[data.sector];
    ui('sector').replaceChildren(sectionLink);
    ui('title').textContent = data.title;
    ui('subtitle').textContent = data.subtitle;
    renderBody(ui('body'), data);
    void renderPhotos(ui('article-photos'), data.photo_paths, ui('body'));
    if (data.published_at) {
        const time = ui('published-time');
        time.dateTime = data.published_at;
        time.textContent = '입력 ' + dateFormat.format(new Date(data.published_at));
    }
    ui('byline').textContent = data.byline_names.join(', ');
    ui('published-article').hidden = false;
    ui('reader-actions').hidden = false;
    enableReadingHeader(data.title);
    void showRelated(data.sector);
    if (data.series_id) void seriesFor(data.sector).then((rows) => {
        const selected = rows.find(({ id }) => id === data.series_id);
        if (!selected) return;
        const link = document.createElement('a');
        link.href = seriesLink(data.sector, selected.id);
        link.textContent = selected.title;
        ui('sector').append(link);
    }).catch(() => {});
    ui('comments-section').hidden = false;
    await commentsAt(0);

    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session) {
        const { data: profile } = await supabase.from('evere_members').select('id')
            .eq('id', sessionData.session.user.id).maybeSingle();
        form.hidden = !profile;
        ui('comment-sign-in').hidden = Boolean(profile);
    }
}

render().catch(() => { ui('status').textContent = '기사를 불러오지 못했습니다.'; });
