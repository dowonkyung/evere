import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { setArticleTitle } from './article-label.js';

const ui = id => document.getElementById('epaper-' + id);
const issues = new Map();
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const toPath = (issue, page) => '/epaper/' + issue + '/' + page;
let current;
let defaultIssue;

function positiveNumber(value) {
    const number = /^[1-9]\d*$/.test(value ?? '') ? Number(value) : 0;
    return Number.isSafeInteger(number) ? number : 0;
}

function requestedEdition() {
    const url = new URL(location.href);
    const parts = /^\/epaper\/([1-9]\d*)(?:\/([1-9]\d*))?\/?$/.exec(url.pathname);
    return [positiveNumber(parts?.[1] ?? url.searchParams.get('issue')),
        positiveNumber(parts?.[2] ?? url.searchParams.get('page'))];
}

function sameSiteAsset(value, extension) {
    if (typeof value !== 'string' || !value.startsWith('/epaper/files/')) return '';
    const url = new URL(value, location.origin);
    return url.origin === location.origin && url.pathname.endsWith(extension) ? url.pathname : '';
}

async function loadPrintArticles() {
    const rows = [];
    const size = 200;
    for (let offset = 0; ; offset += size) {
        const { data, error } = await supabase.from('evere_articles')
            .select('id,article_number,title,article_label,print_issue,print_page,published_at')
            .eq('status', 'published').not('print_issue', 'is', null).not('article_number', 'is', null)
            .order('print_issue', { ascending: false }).order('print_page').order('article_number')
            .range(offset, offset + size - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < size) return rows;
    }
}

function displayDate(date) {
    return date ? date.replaceAll('-', '.') : '';
}

function makeLink(issue, page, label, active) {
    const link = document.createElement('a');
    link.href = toPath(issue, page);
    link.textContent = label;
    if (active) link.setAttribute('aria-current', active);
    return link;
}

function resetZoom() {
    ui('image-scroll').classList.remove('is-zoomed');
    ui('image-scroll').scrollTop = 0;
    ui('image-scroll').scrollLeft = 0;
    ui('zoom').setAttribute('aria-pressed', 'false');
    ui('zoom').textContent = '확대';
}

function render(issueNumber, pageNumber, updateHistory = '') {
    const edition = issues.get(issueNumber);
    if (!edition) {
        current = null;
        ui('heading').textContent = '지면보기';
        ui('date').textContent = '';
        ui('status').textContent = issueNumber ? '해당 발행호를 찾을 수 없습니다.' : '등록된 지면이 없습니다.';
        for (const key of ['stage', 'pagination', 'zoom', 'open-pdf']) ui(key).hidden = true;
        ui('articles').replaceChildren();
        ui('articles-empty').hidden = false;
        return;
    }

    const page = pageNumber || edition.pages[0];
    if (!edition.pages.includes(page)) {
        render(issueNumber, edition.pages[0], 'replaceState');
        return;
    }

    current = { issueNumber, page, edition };
    const path = toPath(issueNumber, page);
    if (updateHistory && location.pathname !== path) history[updateHistory](null, '', path);
    ui('status').textContent = '';
    ui('heading').textContent = issueNumber + '호 ' + page + '면';
    document.title = ui('heading').textContent + ' | 이브레 지면보기';
    ui('date').textContent = displayDate(edition.date);
    ui('paper-edition').textContent = ui('heading').textContent;
    ui('stage').hidden = false;
    ui('pagination').hidden = false;

    const photo = sameSiteAsset(edition.previews?.[page], '.png');
    const pdf = sameSiteAsset(edition.pdf, '.pdf');
    const pdfLink = pdf && pdf + '#page=' + page;
    ui('paper').hidden = Boolean(photo || pdf);
    ui('open-pdf').hidden = !pdf;
    if (pdf) ui('open-pdf').href = pdfLink;
    ui('pdf').hidden = Boolean(photo) || !pdf;
    if (!photo && pdf) ui('pdf').src = pdfLink;
    else ui('pdf').removeAttribute('src');
    ui('image-scroll').hidden = !photo;
    ui('zoom').hidden = !photo;
    resetZoom();
    if (photo) {
        ui('image').alt = issueNumber + '호 ' + page + '면 원본 지면';
        ui('image').src = photo;
    }

    for (const link of ui('editions').querySelectorAll('a[aria-current]')) link.removeAttribute('aria-current');
    ui('editions').querySelector('[data-issue="' + issueNumber + '"]')?.setAttribute('aria-current', 'true');
    ui('pages').replaceChildren(...edition.pages.map(number => {
        const item = document.createElement('li');
        item.append(makeLink(issueNumber, number, number + '면', number === page ? 'page' : ''));
        return item;
    }));

    const index = edition.pages.indexOf(page);
    ui('prev').disabled = index === 0;
    ui('next').disabled = index === edition.pages.length - 1;
    const articles = edition.articles.filter(row => row.print_page === page);
    ui('articles').replaceChildren(...articles.map(row => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = articlePath(row);
        setArticleTitle(link, row.title, row.article_label);
        item.append(link);
        return item;
    }));
    ui('articles-empty').hidden = articles.length > 0;
}

async function start() {
    const [manifest, articles] = await Promise.all([
        fetch('/epaper/editions.json').then(response => response.ok ? response.json() : null).catch(() => null),
        loadPrintArticles().catch(() => null),
    ]);
    for (const edition of manifest?.editions || []) {
        if (Number.isSafeInteger(edition.issue) && edition.issue > 0) issues.set(edition.issue, { ...edition, articles: [], pages: [] });
    }
    for (const article of articles || []) {
        if (!issues.has(article.print_issue)) issues.set(article.print_issue, { articles: [], pages: [] });
        const edition = issues.get(article.print_issue);
        edition.articles.push(article);
        if (article.published_at) {
            const date = dateFormat.format(new Date(article.published_at));
            if (!edition.date || (!edition.pdf && date < edition.date)) edition.date = date;
        }
    }
    for (const edition of issues.values()) {
        const pages = new Set(edition.articles.map(row => row.print_page).filter(Boolean));
        if (Number.isInteger(edition.pageCount) && edition.pageCount > 0 && edition.pageCount <= 300) {
            for (let page = 1; page <= edition.pageCount; page++) pages.add(page);
        }
        edition.pages = [...pages].sort((a, b) => a - b);
        if (!edition.pages.length) edition.pages.push(1);
    }
    const ordered = [...issues.keys()].sort((a, b) => b - a);
    defaultIssue = ordered.find(issue => sameSiteAsset(issues.get(issue).pdf, '.pdf')) || ordered[0];
    ui('editions').replaceChildren(...ordered.map(issue => {
        const edition = issues.get(issue);
        const item = document.createElement('li');
        const link = makeLink(issue, edition.pages[0], issue + '호');
        link.dataset.issue = issue;
        if (edition.date) {
            const time = document.createElement('time');
            time.dateTime = edition.date;
            time.textContent = displayDate(edition.date);
            link.append(time);
        }
        item.append(link);
        return item;
    }));
    const [issue, page] = requestedEdition();
    render(issue || defaultIssue, page, issue ? 'replaceState' : '');
    if (!articles) ui('status').textContent = '기사 목록을 불러오지 못했습니다.';
}

function movePage(step) {
    if (!current) return;
    const index = current.edition.pages.indexOf(current.page);
    const next = current.edition.pages[index + step];
    if (next) render(current.issueNumber, next, 'pushState');
}

ui('prev').onclick = () => movePage(-1);
ui('next').onclick = () => movePage(1);
ui('zoom').onclick = () => {
    const zoomed = ui('image-scroll').classList.toggle('is-zoomed');
    ui('zoom').setAttribute('aria-pressed', String(zoomed));
    ui('zoom').textContent = zoomed ? '축소' : '확대';
};
for (const key of ['editions', 'pages']) {
    ui(key).addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const link = event.target.closest('a');
        if (!link) return;
        const [, , issue, page] = new URL(link.href).pathname.split('/');
        event.preventDefault();
        render(Number(issue), Number(page), 'pushState');
    });
}
window.addEventListener('popstate', () => {
    const [issue, page] = requestedEdition();
    render(issue || defaultIssue, page);
});
void start().catch(() => { ui('status').textContent = '지면을 불러오지 못했습니다.'; });
