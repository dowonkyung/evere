import { supabase } from './supabase.js';
import { setArticleTitle } from './article-label.js';
import { articlePath } from './routes.js?v=routes-1';
import { articleListPicture, loadArticleListPhotos } from './article-list-media.js';

const main = document.querySelector('.evere-series-page');
const ui = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const detail = main.hasAttribute('data-series-detail');
const number = Number(/^\/series\/articles\/([1-9]\d*)\/?$/.exec(location.pathname)?.[1] ?? params.get('number'));
const requestedPage = Number(params.get('page'));
const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
const pageSize = 10;
const start = (page - 1) * pageSize;
const timestamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
});
const columns = 'id,article_number,title,article_label,subtitle,body,photo_paths,published_at';
const seriesPath = number => '/series/articles/' + number;

function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
}

function link(href, text) {
    const a = node('a', text);
    a.href = href;
    return a;
}

function seriesQuery(options) {
    return supabase.from('evere_series')
        .select('id,series_number,title,evere_articles!inner(id)', options)
        .eq('evere_articles.status', 'published').limit(1, { referencedTable: 'evere_articles' });
}

function articlesQuery(id, options) {
    return supabase.from('evere_articles').select(columns, options)
        .eq('status', 'published').eq('series_id', id)
        .order('published_at', { ascending: false }).order('id');
}

function renderPages(total, path) {
    ui('series-count').textContent = total.toLocaleString('ko-KR');
    const last = Math.ceil(total / pageSize);
    if (last < 2) return;
    const list = ui('series-pages');
    const add = (target, label) => {
        const item = node('li');
        if (target === page) {
            const active = node('span', label);
            active.setAttribute('aria-current', 'page');
            item.append(active);
        } else {
            item.append(link(path + (target > 1 ? '?page=' + target : ''), label));
        }
        list.append(item);
    };
    if (page > 1) add(Math.min(last, page - 1), '이전');
    for (let n = Math.max(1, page - 2); n <= Math.min(last, page + 2); n++) add(n, String(n));
    if (page < last) add(page + 1, '다음');
    list.parentElement.hidden = false;
}

function storyCard(entry, includeSummary = false) {
    const article = node('article');
    const copy = node('div');
    const title = link(articlePath(entry));
    setArticleTitle(title, entry.title, entry.article_label);
    copy.append(title);
    if (includeSummary) {
        const description = entry.subtitle || Array.from(entry.body || '').slice(0, 220).join('');
        copy.append(node('p', description, 'desc'), node('p', timestamp.format(new Date(entry.published_at)).replaceAll('-', '.'), 'date'));
    }
    article.append(articleListPicture({ photoPath: entry.photo_paths?.[0] }), copy);
    return article;
}

function configureFollow(series) {
    const button = ui('series-follow');
    const key = 'evere:series-follow:' + series.series_number;
    try {
        const update = () => {
            const followed = localStorage.getItem(key) === '1';
            button.textContent = followed ? '구독 중' : '구독';
            button.setAttribute('aria-pressed', String(followed));
        };
        update();
        button.hidden = false;
        button.addEventListener('click', () => {
            if (localStorage.getItem(key) === '1') localStorage.removeItem(key);
            else localStorage.setItem(key, '1');
            update();
        });
    } catch {
        button.hidden = true;
    }
}

async function recommend(current) {
    const { data, error } = await seriesQuery().neq('id', current.id)
        .order('series_number', { ascending: false }).limit(3);
    if (error || !data?.length) return;
    const results = await Promise.all(data.map(async series => ({
        series, entry: (await articlesQuery(series.id).limit(1).maybeSingle()).data,
    })));
    const list = ui('series-recommended');
    for (const { series, entry } of results) {
        if (!entry) continue;
        const item = node('li');
        const bottom = node('div', '', 'series-bottom');
        bottom.append(link(seriesPath(series.series_number), series.title));
        item.append(storyCard(entry), bottom);
        list.append(item);
    }
    ui('series-recommendations').hidden = !list.childElementCount;
    await loadArticleListPhotos(list);
}

async function loadDetail() {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) {
        ui('series-title').textContent = '등록된 연재를 찾을 수 없습니다.';
        return;
    }
    const path = seriesPath(number);
    history.replaceState(null, '', path + (page > 1 ? '?page=' + page : '') + location.hash);
    document.head.append(Object.assign(node('link'), { rel: 'canonical', href: new URL(path, location.origin).href }));
    const { data: series, error } = await supabase.rpc('evere_series_by_number', { requested_number: number }).maybeSingle();
    if (error) throw error;
    if (!series) {
        ui('series-title').textContent = '등록된 연재를 찾을 수 없습니다.';
        return;
    }
    ui('series-title').textContent = series.title;
    document.title = series.title + ' | 기획·연재 | 이브레';
    configureFollow(series);
    void recommend(series).catch(() => {});

    const { data, count, error: articleError } = await articlesQuery(series.id, { count: 'exact' }).range(start, start + pageSize - 1);
    if (articleError) throw articleError;
    const list = ui('series-articles');
    for (const entry of data) {
        const row = node('li');
        row.append(storyCard(entry, true));
        list.append(row);
    }
    renderPages(count, path);
    ui('series-status').textContent = data.length ? '' : count ? '이 페이지에 표시할 기사가 없습니다.' : '아직 출고된 기사가 없습니다.';
    void loadArticleListPhotos(list).catch(() => {});
}

async function loadDirectory() {
    const { data, count, error } = await seriesQuery({ count: 'exact' })
        .order('series_number', { ascending: false }).range(start, start + pageSize - 1);
    if (error) throw error;
    const list = ui('series-articles');
    for (const series of data) {
        const row = node('li');
        const article = node('article');
        const copy = node('div');
        copy.append(link(seriesPath(series.series_number), series.title));
        article.append(copy);
        row.append(article);
        list.append(row);
    }
    renderPages(count, '/series/');
    ui('series-status').textContent = data.length ? '' : '공개된 기획·연재가 없습니다.';
}

(detail ? loadDetail() : loadDirectory()).catch(() => {
    ui('series-status').textContent = '기획·연재를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
});
