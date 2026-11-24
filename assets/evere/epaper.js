import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { setArticleTitle } from './article-label.js';

const ui = id => document.getElementById('epaper-' + id);
const issues = new Map();
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const toPath = (issue, page) => '/epaper/' + issue + '/' + page;
let current;
let zoom = 1;
let spread = false;
let activePanel = '';
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

function setZoom(value) {
    zoom = Math.max(1, Math.min(3, value));
    const scroll = ui('image-scroll');
    scroll.style.setProperty('--zoom', String(zoom));
    scroll.classList.toggle('is-zoomed', zoom > 1);
    ui('zoom-out').disabled = ui('image-scroll').hidden || zoom === 1;
    ui('zoom').disabled = ui('image-scroll').hidden || zoom === 3;
    if (zoom === 1) { scroll.scrollTop = 0; scroll.scrollLeft = 0; }
}

function showPanel(name) {
    activePanel = name === activePanel ? '' : name;
    ui('panel').hidden = !activePanel;
    ui('panel-title').textContent = ({ issues: '발행호', search: '검색', thumbnails: '썸네일', contents: '목차' })[activePanel] || '';
    for (const panel of document.querySelectorAll('[data-panel-content]')) panel.hidden = panel.dataset.panelContent !== activePanel;
    for (const button of document.querySelectorAll('[data-viewer-panel]')) {
        button.setAttribute('aria-pressed', String(button.dataset.viewerPanel === activePanel));
    }
    if (activePanel === 'search') ui('search').focus();
}

function render(issueNumber, pageNumber, updateHistory = '') {
    const edition = issues.get(issueNumber);
    if (!edition) {
        current = null;
        ui('heading').textContent = '지면보기';
        ui('date').textContent = '';
        ui('status').textContent = issueNumber ? '해당 발행호를 찾을 수 없습니다.' : '등록된 지면이 없습니다.';
        for (const key of ['stage', 'pagination', 'open-pdf']) ui(key).hidden = true;
        for (const key of ['zoom', 'zoom-out', 'spread', 'print']) ui(key).disabled = true;
        ui('page-count').textContent = '—';
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
    ui('date').textContent = edition.date || '발행호 선택';
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
    const index = edition.pages.indexOf(page);
    const nextPage = edition.pages[index + 1];
    const nextPhoto = sameSiteAsset(edition.previews?.[nextPage], '.png');
    const hasSpread = Boolean(spread && photo && nextPhoto);
    ui('spread').disabled = !(photo && nextPhoto);
    ui('spread').setAttribute('aria-pressed', String(hasSpread));
    ui('spread').querySelector('span').textContent = hasSpread ? '양면 보기' : '단면 보기';
    ui('second-image').hidden = !hasSpread;
    if (hasSpread) {
        ui('second-image').src = nextPhoto;
        ui('second-image').alt = issueNumber + '호 ' + nextPage + '면 원본 지면';
    } else {
        ui('second-image').removeAttribute('src');
    }
    ui('image-scroll').classList.toggle('is-spread', hasSpread);
    ui('print').disabled = !photo && !pdf;
    ui('page-count').textContent = page + '/' + (edition.pageCount || Math.max(...edition.pages)) + '면';
    setZoom(1);
    if (photo) {
        ui('image').alt = issueNumber + '호 ' + page + '면 원본 지면';
        ui('image').src = photo;
    }

    for (const link of ui('editions').querySelectorAll('a[aria-current]')) link.removeAttribute('aria-current');
    ui('editions').querySelector('[data-issue="' + issueNumber + '"]')?.setAttribute('aria-current', 'true');
    ui('pages').replaceChildren(...edition.pages.map(number => {
        const item = document.createElement('li');
        const link = makeLink(issueNumber, number, number + '면', number === page ? 'page' : '');
        const thumbnail = sameSiteAsset(edition.previews?.[number], '.png');
        if (thumbnail) {
            const image = document.createElement('img');
            image.src = thumbnail;
            image.alt = '';
            image.loading = 'lazy';
            link.prepend(image);
        }
        item.append(link);
        return item;
    }));

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
ui('zoom').onclick = () => setZoom(zoom + .25);
ui('zoom-out').onclick = () => setZoom(zoom - .25);
ui('spread').onclick = () => {
    if (!current) return;
    spread = !spread;
    render(current.issueNumber, current.page);
};
ui('dark').onclick = () => {
    const active = document.body.classList.toggle('is-dark');
    ui('dark').setAttribute('aria-pressed', String(active));
};
ui('print').onclick = () => {
    if (!ui('image-scroll').hidden) window.print();
    else if (!ui('open-pdf').hidden) window.open(ui('open-pdf').href, '_blank', 'noopener');
};
ui('fullscreen').disabled = !document.fullscreenEnabled;
ui('fullscreen').onclick = () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void action.catch(() => {});
};
document.addEventListener('fullscreenchange', () => ui('fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement)));
ui('pin').onclick = () => {
    const unpinned = ui('pin').closest('.viewer-dock-wrap').classList.toggle('is-unpinned');
    ui('pin').setAttribute('aria-pressed', String(!unpinned));
    ui('pin').querySelector('span').textContent = unpinned ? '고정' : '고정 해제';
};
for (const button of document.querySelectorAll('[data-viewer-panel]')) {
    button.onclick = () => showPanel(button.dataset.viewerPanel);
}
ui('panel-close').onclick = () => showPanel('');
ui('search').oninput = () => {
    const term = ui('search').value.trim().toLocaleLowerCase('ko-KR');
    const matches = term ? [...issues.values()].flatMap(edition => edition.articles)
        .filter(row => row.title.toLocaleLowerCase('ko-KR').includes(term)) : [];
    ui('search-results').replaceChildren(...matches.map(row => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = articlePath(row);
        setArticleTitle(link, row.title, row.article_label);
        item.append(link);
        return item;
    }));
    ui('search-status').textContent = term && !matches.length ? '검색 결과가 없습니다.' : '';
};
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activePanel) showPanel('');
    if (event.altKey || event.metaKey || event.ctrlKey || activePanel || zoom > 1) return;
    if (event.key === 'ArrowLeft') movePage(-1);
    if (event.key === 'ArrowRight') movePage(1);
});
for (const key of ['editions', 'pages']) {
    ui(key).addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const link = event.target.closest('a');
        if (!link) return;
        const [, , issue, page] = new URL(link.href).pathname.split('/');
        event.preventDefault();
        render(Number(issue), Number(page), 'pushState');
        showPanel('');
    });
}
window.addEventListener('popstate', () => {
    const [issue, page] = requestedEdition();
    render(issue || defaultIssue, page);
});
void start().catch(() => { ui('status').textContent = '지면을 불러오지 못했습니다.'; });
