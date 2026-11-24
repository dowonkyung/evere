import { supabase } from './supabase.js';
import { articlePath } from './routes.js';

const params = new URLSearchParams(location.search);
const query = (params.get('query') || '').trim().slice(0, 120);
const requestedPage = Number(params.get('page'));
const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1000 ? requestedPage : 1;
const pageSize = 20;
const offset = (page - 1) * pageSize;
const list = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
const pages = document.querySelector('#search-pages');
document.querySelector('.article-search-form input').value = query;

function pageLink(label, number) {
    const params = new URLSearchParams({ query });
    if (number > 1) params.set('page', number);
    const link = document.createElement('a');
    link.href = '/search/?' + params;
    link.textContent = label;
    pages.append(link);
}

async function loadResults() {
    status.textContent = '검색 중입니다.';
    const keyword = query.replace(/[\\%_]/g, character => '\\' + character);
    const { data, error } = await supabase.from('evere_articles')
        .select('id,article_number,title,subtitle')
        .eq('status', 'published')
        .not('article_number', 'is', null)
        .ilike('title', '%' + keyword + '%')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('id')
        .range(offset, offset + pageSize);
    if (error) throw error;

    for (const article of data.slice(0, pageSize)) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = articlePath(article);
        link.textContent = article.title;
        item.append(link);
        if (article.subtitle) {
            const subtitle = document.createElement('p');
            subtitle.textContent = article.subtitle;
            item.append(subtitle);
        }
        list.append(item);
    }
    status.textContent = data.length ? '‘' + query + '’ 검색 결과' : '검색 결과가 없습니다.';
    if (page > 1) pageLink('이전 페이지', page - 1);
    if (data.length > pageSize && page < 1000) pageLink('다음 페이지', page + 1);
    pages.hidden = !pages.childElementCount;
}

if (query) {
    loadResults().catch(() => {
        status.textContent = '검색 결과를 불러오지 못했습니다. 다시 시도해 주세요.';
    });
}
