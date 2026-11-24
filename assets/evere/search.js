import { supabase } from './supabase.js';
import { articlePath } from './routes.js';
import { articleCategories, sectors } from './article-taxonomy.js';
import { photoBucket } from './article-content.js?v=caption-1';

const params = new URLSearchParams(location.search);
const query = (params.get('query') || '').trim().slice(0, 120);
const sectionNames = { articles: '기사', opinion: '사설·칼럼', images: '이미지' };
const requestedSection = params.get('section');
const section = Object.hasOwn(sectionNames, requestedSection) ? requestedSection : 'all';
const period = ['1', '7', '30', '365'].includes(params.get('period')) ? params.get('period') : '';
const scope = ['title', 'body', 'subtitle'].includes(params.get('scope')) ? params.get('scope') : '';
const sort = params.get('sort') === 'oldest' ? 'oldest' : '';
const requestedPage = Number(params.get('page'));
const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1000 ? requestedPage : 1;
const pageSize = 20;
const offset = (page - 1) * pageSize;
const list = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
const pages = document.querySelector('#search-pages');
document.querySelector('.article-search-form input').value = query;


const searchForm = document.querySelector('#search-form');
searchForm.elements.section.value = section;
const filters = document.querySelector('#search-filters');
filters.elements.query.value = query;
filters.elements.section.value = section;
filters.elements.period.value = period;
filters.elements.sort.value = sort;
filters.elements.scope.value = scope;
document.querySelector('#search-reset').href = searchUrl(section, 1, false);

function searchUrl(targetSection, number = 1, preserveFilters = true) {
    const search = new URLSearchParams();
    if (query) search.set('query', query);
    if (targetSection !== 'all') search.set('section', targetSection);
    if (preserveFilters && period) search.set('period', period);
    if (preserveFilters && sort) search.set('sort', sort);
    if (preserveFilters && scope) search.set('scope', scope);
    if (number > 1) search.set('page', number);
    return '/search/' + (search.size ? '?' + search : '');
}

for (const link of document.querySelectorAll('.search-sections a')) {
    const target = link.dataset.section;
    link.href = searchUrl(target);
    if (target === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
}

function pageLink(label, number) {
    const link = document.createElement('a');
    link.href = searchUrl(section, number);
    link.textContent = label;
    pages.append(link);
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric',
});

const highlighted = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
function appendHighlight(element, value) {
    value.split(highlighted).forEach((text, i) => {
        if (i % 2 === 0) element.append(text);
        else {
            const mark = document.createElement('mark');
            mark.textContent = text;
            element.append(mark);
        }
    });
}

function renderResult(target, kind, article, photoUrls) {
    const item = document.createElement('li');
    const href = articlePath(article);
    const title = document.createElement('a');
    title.className = 'search-result-title';
    title.href = href;
    appendHighlight(title, article.title);
    const photoUrl = photoUrls.get(article.photo_paths?.[0]);
    const photo = document.createElement('a');
    if (photoUrl) {
        photo.className = 'search-result-photo';
        photo.href = href;
        photo.setAttribute('aria-label', article.title);
        const image = document.createElement('img');
        image.src = photoUrl;
        image.alt = '';
        image.loading = 'lazy';
        photo.append(image);
    }
    if (kind === 'images') {
        if (photoUrl) item.append(photo);
        item.append(title);
    } else {
        const copy = document.createElement('div');
        copy.className = 'search-result-copy';
        const categoryName = articleCategories[article.sector]?.find(([id]) => id === article.category)?.[1] || sectors[article.sector];
        if (categoryName) {
            const category = document.createElement('p');
            category.className = 'search-result-category';
            category.textContent = categoryName;
            copy.append(category);
        }
        copy.append(title);
        const description = article.subtitle || article.body?.trim().replace(/\s+/g, ' ').slice(0, 200);
        if (description) {
            const subtitle = document.createElement('p');
            subtitle.className = 'search-result-description';
            appendHighlight(subtitle, description);
            copy.append(subtitle);
        }
        if (article.published_at) {
            const time = document.createElement('time');
            time.dateTime = article.published_at;
            time.textContent = [article.byline_names?.join(' · '), dateFormat.format(new Date(article.published_at))].filter(Boolean).join('　');
            copy.append(time);
        }
        if (photoUrl) item.append(photo);
        item.append(copy);
    }
    target.append(item);
}

async function fetchResults(kind, limit, start) {
    const keyword = query.replace(/[\\%_]/g, character => '\\' + character);
    const pattern = '%' + keyword + '%';
    let request = supabase.from('evere_articles')
        .select('id,article_number,title,subtitle,body,published_at,photo_paths,sector,category,byline_names', { count: 'exact' })
        .eq('status', 'published')
        .not('article_number', 'is', null);
    const quoted = '"' + pattern.replace(/["\\]/g, '\\$&') + '"';
    const match = ['title', 'subtitle', 'body'].map(field => field + '.ilike.' + quoted).join(',');
    if (scope) request = request.ilike(scope, pattern);
    if (kind === 'opinion') {
        request = request.eq('sector', 'opinion').in('category', ['editorial', 'column']);
    } else if (kind === 'images') {
        request = request.not('photo_paths', 'is', null).neq('photo_paths', '{}');
    }
    if (kind === 'articles') {
        const news = 'or(sector.neq.opinion,category.is.null,category.not.in.(editorial,column))';
        request = scope ? request.or(news.slice(3, -1)) : request.or('and(' + news + ',or(' + match + '))');
    } else if (!scope) {
        request = request.or(match);
    }
    if (period) request = request.gte('published_at', new Date(Date.now() - Number(period) * 86400000).toISOString());
    const { data, count, error } = await request
        .order('published_at', { ascending: sort === 'oldest', nullsFirst: false })
        .order('id')
        .range(start, start + limit - 1);
    if (error) throw error;
    return { kind, data, count };
}

function renderGroup({ kind, data, count }, photoUrls) {
    const group = document.createElement('section');
    const title = document.createElement('h2');
    title.textContent = sectionNames[kind];
    group.append(title);
    const items = document.createElement('ul');
    items.className = kind === 'images' ? 'search-image-grid' : 'search-article-list';
    for (const article of data) renderResult(items, kind, article, photoUrls);
    group.append(items);
    if (section === 'all' && count > data.length) {
        const link = document.createElement('a');
        link.className = 'search-view-all';
        link.href = searchUrl(kind);
        const total = document.createElement('strong');
        total.textContent = count.toLocaleString('ko-KR') + '건';
        link.append(total, ' 전체 보기');
        group.append(link);
    }
    list.append(group);
}

async function loadResults() {
    status.textContent = '검색 중입니다.';
    const overview = section === 'all';
    const kinds = overview ? Object.keys(sectionNames) : [section];
    const groups = await Promise.all(kinds.map(kind => fetchResults(kind, overview ? 4 : pageSize, overview ? 0 : offset)));
    const paths = [...new Set(groups.flatMap(group => group.data.map(article => article.photo_paths?.[0])).filter(Boolean))];
    const photoUrls = new Map();
    if (paths.length) {
        const response = await Promise.resolve(photoBucket.createSignedUrls(paths, 3600)).catch(() => null);
        for (const entry of response?.data || []) {
            if (entry.signedUrl) photoUrls.set(entry.path, entry.signedUrl);
        }
    }
    const count = groups[0].count;
    status.textContent = groups.some(group => group.data.length) ? '' : '검색 결과가 없습니다.';
    for (const group of groups) {
        if (group.data.length) renderGroup(group, photoUrls);
    }
    if (!overview && page > 1) pageLink('이전 페이지', page - 1);
    if (!overview && count > offset + pageSize && page < 1000) pageLink('다음 페이지', page + 1);
    pages.hidden = !pages.childElementCount;
}

if (query) {
    loadResults().catch(() => {
        status.textContent = '검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.';
    });
} else {
    status.textContent = '검색어를 입력해 주세요.';
}
