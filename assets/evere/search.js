import { supabase } from './supabase.js';
import { articlePath } from './routes.js';
import { photoBucket } from './article-content.js?v=caption-1';

const params = new URLSearchParams(location.search);
const query = (params.get('query') || '').trim().slice(0, 120);
const sectionNames = { articles: '기사', opinion: '사설·칼럼', images: '이미지' };
const requestedSection = params.get('section');
const section = Object.hasOwn(sectionNames, requestedSection) ? requestedSection : 'articles';
const period = ['7', '30', '365'].includes(params.get('period')) ? params.get('period') : '';
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

function searchUrl(targetSection, number = 1) {
    const search = new URLSearchParams();
    if (query) search.set('query', query);
    if (targetSection !== 'articles') search.set('section', targetSection);
    if (period) search.set('period', period);
    if (sort) search.set('sort', sort);
    if (number > 1) search.set('page', number);
    return '/search/' + (search.size ? '?' + search : '');
}

for (const link of document.querySelectorAll('.search-sections a')) {
    const target = link.dataset.section;
    link.href = searchUrl(target);
    if (target === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
}
list.classList.toggle('search-image-grid', section === 'images');

function pageLink(label, number) {
    const link = document.createElement('a');
    link.href = searchUrl(section, number);
    link.textContent = label;
    pages.append(link);
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric',
});

function renderResult(article, photoUrls) {
    const item = document.createElement('li');
    const href = articlePath(article);
    const title = document.createElement('a');
    title.className = 'search-result-title';
    title.href = href;
    title.textContent = article.title;
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
    if (section === 'images') {
        if (photoUrl) item.append(photo);
        item.append(title);
    } else {
        const copy = document.createElement('div');
        copy.className = 'search-result-copy';
        copy.append(title);
        if (article.subtitle) {
            const subtitle = document.createElement('p');
            subtitle.textContent = article.subtitle;
            copy.append(subtitle);
        }
        if (article.published_at) {
            const time = document.createElement('time');
            time.dateTime = article.published_at;
            time.textContent = dateFormat.format(new Date(article.published_at));
            copy.append(time);
        }
        item.append(copy);
        if (photoUrl) item.append(photo);
    }
    list.append(item);
}

async function loadResults() {
    status.textContent = '검색 중입니다.';
    const keyword = query.replace(/[\\%_]/g, character => '\\' + character);
    let request = supabase.from('evere_articles')
        .select('id,article_number,title,subtitle,published_at,photo_paths', { count: 'exact' })
        .eq('status', 'published')
        .not('article_number', 'is', null)
        .ilike('title', '%' + keyword + '%');
    if (section === 'opinion') {
        request = request.eq('sector', 'opinion').in('category', ['editorial', 'column']);
    } else if (section === 'images') {
        request = request.not('photo_paths', 'is', null).neq('photo_paths', '{}');
    } else {
        request = request.or('sector.neq.opinion,category.is.null,category.not.in.(editorial,column)');
    }
    if (period) request = request.gte('published_at', new Date(Date.now() - Number(period) * 86400000).toISOString());
    const { data, count, error } = await request
        .order('published_at', { ascending: sort === 'oldest', nullsFirst: false })
        .order('id')
        .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const paths = [...new Set(data.map(article => article.photo_paths?.[0]).filter(Boolean))];
    const photoUrls = new Map();
    if (paths.length) {
        const response = await Promise.resolve(photoBucket.createSignedUrls(paths, 3600)).catch(() => null);
        for (const entry of response?.data || []) {
            if (entry.signedUrl) photoUrls.set(entry.path, entry.signedUrl);
        }
    }
    for (const article of data) renderResult(article, photoUrls);

    status.textContent = count
        ? '‘' + query + '’ ' + sectionNames[section] + ' 검색 결과 ' + count.toLocaleString('ko-KR') + '건'
        : '검색 결과가 없습니다.';
    if (page > 1) pageLink('이전 페이지', page - 1);
    if (count > offset + pageSize && page < 1000) pageLink('다음 페이지', page + 1);
    pages.hidden = !pages.childElementCount;
}

if (query) {
    loadResults().catch(() => {
        status.textContent = '검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.';
    });
} else {
    status.textContent = '검색어를 입력해 주세요.';
}
