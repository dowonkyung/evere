import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { setArticleTitle } from './article-label.js';

const list = document.getElementById('recentList');
const status = document.getElementById('notice-status');
const pages = document.getElementById('notice-pages');
const pageSize = 20;
const requestedPage = Number(new URLSearchParams(location.search).get('page'));
const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= Math.floor(Number.MAX_SAFE_INTEGER / pageSize)
    ? requestedPage : 1;
const offset = (page - 1) * pageSize;
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

function pageLink(number, label) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = number === 1 ? '/notice/' : '/notice/?page=' + number;
    link.textContent = label;
    if (number === page) link.setAttribute('aria-current', 'page');
    item.append(link);
    pages.append(item);
}

try {
    const { data, count, error } = await supabase.from('evere_articles')
        .select('article_number,title,article_label,published_at', { count: 'exact' })
        .eq('sector', 'notice').eq('status', 'published')
        .order('published_at', { ascending: false }).order('id')
        .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const notice of data) {
        const row = document.createElement('li');
        const article = document.createElement('article');
        const copy = document.createElement('div');
        const link = document.createElement('a');
        link.href = articlePath(notice);
        setArticleTitle(link, notice.title, notice.article_label);
        const date = document.createElement('p');
        date.className = 'date';
        if (notice.published_at) date.textContent = dateFormat.format(new Date(notice.published_at)).replaceAll('-', '.');
        copy.append(link, date);
        article.append(copy);
        row.append(article);
        list.append(row);
    }
    status.textContent = data.length ? '' : '등록된 알림이 없습니다.';
    const pageCount = Math.ceil(count / pageSize);
    if (page > 1) pageLink(data.length ? page - 1 : 1, data.length ? '이전' : '첫 페이지');
    if (pageCount > 1 && data.length) pageLink(page, String(page));
    if (page < pageCount) pageLink(page + 1, '다음');
    pages.parentElement.hidden = !pages.childElementCount;
} catch {
    status.textContent = '알림을 불러오지 못했습니다.';
}
