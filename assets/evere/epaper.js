import { configureArticleViewer, indexPdf } from './epaper-article.js?v=region-image-1';
import { configurePrintSearch } from './epaper-search.js?v=2';
import { supabase } from './supabase.js';
import { setArticleTitle } from './article-label.js';

const ui = id => document.getElementById('epaper-' + id);
const issues = new Map();
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
const toPath = (issue, page) => '/epaper/' + issue + '/' + page;
let current;
let zoom = 1;
let spread = false;
let activePanel = '';
let imageRequest = 0;
let zoomAnimations = [];
const articleViewer = configureArticleViewer(id => {
    for (const link of ui('articles').querySelectorAll('[data-print-article]')) {
        if (Number(link.dataset.printArticle) === id) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
    }
}, (issue, page, regions) => {
    savedRegions.set(regionKey(issue, page), regions);
    if (current?.issueNumber === issue && current.page === page) render(issue, page);
}, destination => {
    if (!current) return;
    const row = current.edition.articles.find(article => article.article_number === destination.article);
    if (!row) return;
    if (current.page !== destination.page) render(current.issueNumber, destination.page, 'pushState');
    articleViewer.openArticle(row, destination.page);
});
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let defaultIssue;
let canEditRegions = false;
const savedRegions = new Map();
const regionKey = (issue, page) => issue + ':' + page;
function regionsFor(edition, issue, page) {
    const rows = new Map((edition.regions?.[page] || []).map(entry => [entry.article, entry]));
    for (const entry of savedRegions.get(regionKey(issue, page)) || []) rows.set(entry.article, entry);
    return [...rows.values()];
}
async function loadSavedRegions() {
    const size = 300;
    for (let from = 0; ; from += size) {
        const { data, error } = await supabase.from('evere_epaper_regions').select('issue,page,article_number,points,png_path,print_title,print_body,next_page,next_article')
            .order('issue').order('page').order('article_number').range(from, from + size - 1);
        if (error) return;
        for (const row of data) {
            const key = regionKey(row.issue, row.page);
            if (!savedRegions.has(key)) savedRegions.set(key, []);
            savedRegions.get(key).push({ article: row.article_number, points: row.points, pngPath: row.png_path, printTitle: row.print_title, printBody: row.print_body,
                next: row.next_page ? { page: row.next_page, article: row.next_article } : null });
        }
        if (data.length < size) return;
    }
}
async function loadImageRegions() {
    const size = 300;
    for (let from = 0; ; from += size) {
        const { data, error } = await supabase.from('evere_epaper_image_regions')
            .select('id,issue,page,points,png_path').order('id').range(from, from + size - 1);
        if (error) return;
        for (const row of data) {
            const key = regionKey(row.issue, row.page);
            if (!savedRegions.has(key)) savedRegions.set(key, []);
            savedRegions.get(key).push({ article: row.id, points: row.points, pngPath: row.png_path, imageOnly: true });
        }
        if (data.length < size) return;
    }
}
void supabase.auth.getUser().then(async ({ data }) => {
    if (!data?.user) return;
    const { data: member } = await supabase.from('evere_members').select('role').eq('id', data.user.id).maybeSingle();
    canEditRegions = member?.role === 'owner';
    if (canEditRegions && current) render(current.issueNumber, current.page);
}).catch(() => {});


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

function continuationTargets(edition, issue, page) {
    return edition.pages.filter(number => number !== page).flatMap(number => {
        const ids = new Set(regionsFor(edition, issue, number).map(entry => entry.article));
        return edition.articles.filter(row => ids.has(row.article_number))
            .map(row => ({ page: number, article: row.article_number, title: row.title }));
    });
}

function previousRegion(edition, issue, page, article) {
    for (const number of edition.pages) {
        const previous = regionsFor(edition, issue, number).find(entry => entry.next?.page === page && entry.next.article === article);
        if (previous) return { page: number, article: previous.article };
    }
    return null;
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

function setZoom(value, animate = false, targetPoint) {
    const nextZoom = Math.max(1, Math.min(3, value));
    const scroll = ui('image-scroll');
    const images = [...scroll.querySelectorAll('img:not([hidden])')];
    const animateChange = animate && nextZoom !== zoom && !reduceMotion.matches;
    const previous = animateChange ? images.map(image => image.getBoundingClientRect()) : [];
    for (const animation of zoomAnimations) animation.cancel();
    zoomAnimations = [];
    const viewport = scroll.getBoundingClientRect();
    const centerX = viewport.left + scroll.clientWidth / 2;
    const centerY = viewport.top + scroll.clientHeight / 2;
    zoom = nextZoom;
    scroll.style.setProperty('--zoom', String(zoom));
    scroll.classList.toggle('is-zoomed', zoom > 1);
    ui('zoom-out').disabled = scroll.hidden || zoom === 1;
    ui('zoom').disabled = scroll.hidden || zoom === 3;
    if (zoom === 1) {
        scroll.scrollTop = 0;
        scroll.scrollLeft = 0;
    } else if (targetPoint) {
        const image = images[targetPoint.side];
        if (image) {
            const target = image.getBoundingClientRect();
            scroll.scrollLeft += target.left + targetPoint.x * target.width - centerX;
            scroll.scrollTop += target.top + targetPoint.y * target.height - centerY;
        }
    } else if (previous.length && previous[0].width && previous[0].height) {
        const target = images[0].getBoundingClientRect();
        scroll.scrollLeft += target.left + (centerX - previous[0].left) * target.width / previous[0].width - centerX;
        scroll.scrollTop += target.top + (centerY - previous[0].top) * target.height / previous[0].height - centerY;
    }
    if (!animateChange) return;
    articleViewer.track(250);
    printSearch.track();
    for (const [index, image] of images.entries()) {
        const from = previous[index];
        const to = image.getBoundingClientRect();
        if (!from.width || !from.height || !to.width || !to.height) continue;
        const scaleX = from.width / to.width;
        const scaleY = from.height / to.height;
        zoomAnimations.push(image.animate([
            { transformOrigin: '0 0', transform: 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px) scale(' + scaleX + ',' + scaleY + ')' },
            { transformOrigin: '0 0', transform: 'translate(0,0) scale(1)' },
        ], { duration: 250, easing: 'cubic-bezier(.2,0,0,1)' }));
    }
}

function showPanel(name) {
    activePanel = name === activePanel ? '' : name;
    ui('panel').inert = !activePanel;
    ui('panel').closest('.viewer-main').classList.toggle('has-panel', Boolean(activePanel));
    ui('panel-title').textContent = ({ search: '검색', thumbnails: '썸네일', contents: '목차' })[activePanel] || '';
    for (const panel of document.querySelectorAll('[data-panel-content]')) panel.hidden = panel.dataset.panelContent !== activePanel;
    for (const button of document.querySelectorAll('[data-viewer-panel]')) {
        button.setAttribute('aria-pressed', String(button.dataset.viewerPanel === activePanel));
    }
    if (activePanel === 'search') ui('search').focus();
    printSearch.setVisible(activePanel === 'search');
}

function animatePageFlip(direction) {
    if (!direction || reduceMotion.matches) return;
    const image = ui('image');
    const stage = ui('stage');
    if (ui('image-scroll').hidden || !image.complete || !image.naturalWidth) return;
    const paper = image.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const prior = image.cloneNode();
    prior.removeAttribute('id');
    prior.className = 'viewer-page-flip';
    prior.alt = '';
    prior.setAttribute('aria-hidden', 'true');
    Object.assign(prior.style, {
        left: paper.left - frame.left + 'px',
        top: paper.top - frame.top + 'px',
        width: paper.width + 'px',
        height: paper.height + 'px',
        transformOrigin: direction > 0 ? 'left center' : 'right center',
    });
    stage.append(prior);
    const animation = prior.animate([
        { rotate: 'y 0deg', opacity: 1, filter: 'brightness(1)' },
        { rotate: 'y ' + (direction * -55) + 'deg', opacity: .82, filter: 'brightness(.80)', offset: .65 },
        { rotate: 'y ' + (direction * -89) + 'deg', opacity: 0, filter: 'brightness(.72)' },
    ], { duration: 550, easing: 'cubic-bezier(.42,0,.3,1)' });
    animation.onfinish = () => prior.remove();
    animation.oncancel = () => prior.remove();
}

function setPageImage(src, label) {
    const stage = ui('stage');
    const image = ui('image');
    const request = ++imageRequest;
    stage.classList.remove('is-loading', 'page-loaded');
    image.alt = label;
    if (image.getAttribute('src') !== src) image.src = src;
    const loading = setTimeout(() => {
        if (request === imageRequest) stage.classList.add('is-loading');
    }, 150);
    const ready = image.decode ? image.decode() : Promise.resolve();
    void ready.then(() => {
        if (request === imageRequest) stage.classList.add('page-loaded');
    }).catch(() => {}).finally(() => {
        clearTimeout(loading);
        if (request === imageRequest) stage.classList.remove('is-loading');
    });
}

function render(issueNumber, pageNumber, updateHistory = '') {
    const edition = issues.get(issueNumber);
    if (!edition) {
        current = null;
        ui('heading').textContent = '지면보기';
        ui('date').textContent = '';
        ui('status').textContent = issueNumber ? '해당 발행호를 찾을 수 없습니다.' : '등록된 지면이 없습니다.';
        for (const key of ['stage', 'pagination', 'download']) ui(key).hidden = true;
        for (const key of ['zoom', 'zoom-out', 'spread', 'print']) ui(key).disabled = true;
        ui('page-count').textContent = '—';
        printSearch.setIssue(null, '');
        printSearch.setPages(null, null);
        articleViewer.setSheets([]);
        ui('articles').replaceChildren();
        ui('articles-empty').hidden = false;
        return;
    }

    const page = pageNumber || edition.pages[0];
    if (!edition.pages.includes(page)) {
        render(issueNumber, edition.pages[0], 'replaceState');
        return;
    }

    if (current?.issueNumber === issueNumber && current.page !== page && zoom === 1) {
        animatePageFlip(Math.sign(page - current.page));
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
    const download = ui('download');
    download.hidden = !photo;
    if (photo) {
        download.href = photo;
        download.download = '이브레-' + issueNumber + '호-' + page + '면.png';
    } else {
        download.removeAttribute('href');
    }
    ui('print').dataset.pdf = pdfLink || '';
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
    const totalPages = edition.pageCount || Math.max(...edition.pages);
    ui('page-count').textContent = page + '/' + totalPages + '면';
    const weekday = edition.date
        ? new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'Asia/Seoul' })
            .format(new Date(edition.date + 'T00:00:00+09:00'))
        : '';
    ui('thumbnail-summary').textContent =
        [edition.date ? displayDate(edition.date) + ' (' + weekday + ')' : '', totalPages + '면'].filter(Boolean).join(' · ');
    setZoom(1);
    if (photo) setPageImage(photo, issueNumber + '호 ' + page + '면 원본 지면');
    else {
        imageRequest++;
        ui('stage').classList.remove('is-loading', 'page-loaded');
    }
    printSearch.setIssue(issueNumber, pdf);
    articleViewer.setSheets([
        { image: ui('image'), src: photo, pdf, printText: sameSiteAsset(edition.printText, '.json'), page, issue: issueNumber, editable: canEditRegions, destinations: continuationTargets(edition, issueNumber, page), regions: regionsFor(edition, issueNumber, page).map(entry => ({...entry, previous: previousRegion(edition, issueNumber, page, entry.article)})), articles: edition.articles },
        { image: ui('second-image'), src: hasSpread ? nextPhoto : '', pdf, printText: sameSiteAsset(edition.printText, '.json'), page: nextPage, issue: issueNumber, regions: regionsFor(edition, issueNumber, nextPage).map(entry => ({...entry, previous: previousRegion(edition, issueNumber, nextPage, entry.article)})), articles: edition.articles },
    ]);

    printSearch.setPages(page, hasSpread ? nextPage : null);
    for (const link of ui('editions').querySelectorAll('a[aria-current]')) link.removeAttribute('aria-current');
    ui('editions').querySelector('[data-issue="' + issueNumber + '"]')?.setAttribute('aria-current', 'true');
    ui('pages').replaceChildren(...edition.pages.map(number => {
        const item = document.createElement('li');
        const pageLabel = String(number).padStart(2, '0') + '면';
        const link = makeLink(issueNumber, number, '', number === page ? 'page' : '');
        const thumbnail = sameSiteAsset(edition.previews?.[number], '.png');
        if (thumbnail) {
            const image = document.createElement('img');
            image.src = thumbnail;
            image.alt = '';
            image.loading = 'lazy';
            link.append(image);
        }
        const label = document.createElement('span');
        label.textContent = pageLabel;
        link.append(label);
        item.append(link);
        return item;
    }));

    ui('prev').disabled = index === 0;
    ui('next').disabled = index === edition.pages.length - 1;
    const groups = new Map();
    for (const article of edition.articles) {
        if (!article.print_page) continue;
        if (!groups.has(article.print_page)) groups.set(article.print_page, []);
        groups.get(article.print_page).push(article);
    }
    ui('articles').replaceChildren(...edition.pages.filter(number => groups.has(number)).map(number => {
        const group = document.createElement('li');
        const heading = document.createElement('h3');
        const jump = makeLink(issueNumber, number, String(number).padStart(2, '0') + '면', number === page ? 'page' : '');
        jump.dataset.contentsPage = number;
        heading.append(jump);
        const list = document.createElement('ul');
        for (const row of groups.get(number)) {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = toPath(issueNumber, number);
            link.dataset.contentsPage = number;
            link.dataset.printArticle = row.article_number;
            const region = regionsFor(edition, issueNumber, number).find(entry => entry.article === row.article_number);
            setArticleTitle(link, region?.printTitle || row.title, row.article_label);
            item.append(link);
            list.append(item);
        }
        group.append(heading, list);
        return group;
    }));
    ui('articles-empty').hidden = groups.size > 0;
}

async function start() {
    const [manifest, articles] = await Promise.all([
        fetch('/epaper/editions.json?v=print-reader-1').then(response => response.ok ? response.json() : null).catch(() => null),
        loadPrintArticles().catch(() => null),
        loadSavedRegions().catch(() => {}),
        loadImageRegions().catch(() => {}),
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
    const ordered = [...issues.keys()].sort((a, b) =>
        (issues.get(b).date || '').localeCompare(issues.get(a).date || '') || b - a);
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
ui('stage').addEventListener('dblclick', event => {
    if (!current || articleViewer.isEditing() || event.target.closest('button, a')) return;
    event.preventDefault();
    setZoom(zoom > 1 ? 1 : 2, true);
});
ui('stage').addEventListener('contextmenu', event => event.preventDefault());
ui('stage').addEventListener('dragstart', event => event.preventDefault());
ui('zoom').onclick = () => setZoom(zoom + .25, true);
ui('zoom-out').onclick = () => setZoom(zoom - .25, true);
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
    else if (ui('print').dataset.pdf) window.open(ui('print').dataset.pdf, '_blank', 'noopener');
};
ui('fullscreen').disabled = !document.fullscreenEnabled;
ui('fullscreen').onclick = () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void action.catch(() => {});
};
document.addEventListener('fullscreenchange', () => ui('fullscreen').setAttribute('aria-pressed', String(!!document.fullscreenElement)));
const dock = ui('pin').closest('.viewer-dock-wrap');
const repin = ui('repin');
repin.hidden = false;
function setToolbarPinned(pinned) {
    if (!pinned) articleViewer.closeEditor();
    dock.classList.toggle('is-toolbar-hidden', !pinned);
    repin.classList.toggle('is-toolbar-hidden', pinned);
    dock.inert = !pinned;
    repin.inert = pinned;
    try { localStorage.setItem('evere-epaper-toolbar-pinned', String(pinned)); } catch {}
}
try { setToolbarPinned(localStorage.getItem('evere-epaper-toolbar-pinned') !== 'false'); } catch { setToolbarPinned(true); }
ui('pin').onclick = () => { setToolbarPinned(false); repin.focus({ preventScroll: true }); };
repin.onclick = () => { setToolbarPinned(true); ui('pin').focus({ preventScroll: true }); };
for (const button of document.querySelectorAll('[data-viewer-panel]')) {
    button.onclick = () => showPanel(button.dataset.viewerPanel);
}
ui('panel-close').onclick = () => showPanel('');
function setIssuePopover(open, restoreFocus = false) {
    ui('issue-popover').hidden = !open;
    ui('calendar-toggle').setAttribute('aria-expanded', String(open));
    if (restoreFocus) ui('calendar-toggle').focus();
}
ui('calendar-toggle').onclick = () => setIssuePopover(ui('issue-popover').hidden);
ui('issue-close').onclick = () => setIssuePopover(false, true);
document.addEventListener('click', event => {
    if (!ui('issue-popover').hidden && !event.target.closest('.viewer-issue-popover, .viewer-date')) {
        setIssuePopover(false);
    }
});
ui('date-toggle').onclick = () => {
    const collapsed = ui('date-toggle').getAttribute('aria-expanded') === 'true';
    ui('date-details').inert = collapsed;
    ui('date-details').toggleAttribute('data-collapsed', collapsed);
    ui('date-toggle').setAttribute('aria-expanded', String(!collapsed));
    ui('date-toggle').setAttribute('aria-label', collapsed ? '날짜와 로고 펼치기' : '날짜와 로고 접기');
    if (collapsed) setIssuePopover(false);
};
ui('articles').addEventListener('click', event => {
    const link = event.target.closest('[data-contents-page]');
    if (!link || !current || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    const number = Number(link.dataset.contentsPage);
    if (current.page !== number) render(current.issueNumber, number, 'pushState');
    const row = current.edition.articles.find(article => article.article_number === Number(link.dataset.printArticle));
    if (row) articleViewer.openArticle(row, number);
});
const printSearch = configurePrintSearch(indexPdf, () => current, (page, match, side) => {
    if (current?.page !== page) render(current.issueNumber, page, 'pushState');
    articleViewer.closeArticle();
    if (!match || !match.boxes.length) return;
    const firstY = match.boxes[0][1];
    const firstLine = match.boxes.filter(box => Math.abs(box[1] - firstY) < 3);
    const left = Math.min(...firstLine.map(box => box[0]));
    const right = Math.max(...firstLine.map(box => box[0] + box[2]));
    const image = ui(side ? 'second-image' : 'image');
    const issue = current.issueNumber;
    const focus = () => {
        if (current?.issueNumber !== issue || current.page !== page) return;
        setZoom(2.5, true, { side, x:(left + right) / 2000, y:(firstY + firstLine[0][3] / 2) / 1000 });
    };
    if (image.complete && image.naturalWidth) requestAnimationFrame(focus);
    else image.addEventListener('load', focus, { once:true });
}, () => articleViewer.track(350));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !ui('issue-popover').hidden) {
        setIssuePopover(false, true);
        return;
    }
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
        if (key === 'editions') setIssuePopover(false, true);
        else showPanel('');
    });
}
window.addEventListener('popstate', () => {
    const [issue, page] = requestedEdition();
    render(issue || defaultIssue, page);
});
void start().catch(() => { ui('status').textContent = '지면을 불러오지 못했습니다.'; });
