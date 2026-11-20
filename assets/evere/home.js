const header = document.querySelector('#evere-header').shadowRoot;
const shell = header.querySelector('.yna-shell');
const mainHeader = header.querySelector('.wrap-header02');
const compactHeader = header.querySelector('.wrap-header21');
const search = header.querySelector('.evere-search');
const menu = header.querySelector('.popup-whole-home01');
const closeMenu = menu.querySelector('[data-close-sitemap]');
const desktop = matchMedia('(min-width: 1024px)');
let activeHeader = mainHeader;

function togglePanel(panel, button, open) {
    panel.hidden = !open;
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
    button.querySelector('.ir-txt01').textContent =
        button.dataset.a11yTxt.split(';')[open ? 0 : 1];
}

function setMenuOpen(open, section) {
    const button = activeHeader.querySelector('button.menu01');
    togglePanel(menu, button, open);
    menu.classList.toggle('active', open);
    document.documentElement.classList.toggle('evere-sitemap-open', open);
    if (open) {
        menu.scrollTop = 0;
        const title = section ? menu.querySelector('#sitemap-' + section + ' strong') : null;
        if (title) title.focus();
        else if (desktop.matches) menu.focus();
        else closeMenu.focus();
    }
}

for (const container of [mainHeader, compactHeader]) {
    const searchToggle = container.querySelector('.btn-srch-switch');
    const menuToggle = container.querySelector('button.menu01');

    searchToggle.addEventListener('click', () => {
        togglePanel(search, searchToggle, search.hidden);
        setMenuOpen(false);
        if (!search.hidden) search.querySelector('input').focus();
    });

    menuToggle.addEventListener('click', () => {
        togglePanel(search, searchToggle, false);
        setMenuOpen(menu.hidden);
    });

    container.querySelector('.evere-news-links').addEventListener('click', (event) => {
        const link = event.target.closest('[data-sitemap-section]');
        if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        togglePanel(search, searchToggle, false);
        setMenuOpen(true, link.dataset.sitemapSection);
    });
}

closeMenu.addEventListener('click', () => {
    setMenuOpen(false);
    activeHeader.querySelector('button.menu01').focus();
});

document.addEventListener('click', (event) => {
    if (!menu.hidden && !event.composedPath().includes(header.host)) setMenuOpen(false);
});

header.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || (search.hidden && menu.hidden)) return;
    if (!menu.hidden) {
        setMenuOpen(false);
        activeHeader.querySelector('button.menu01').focus();
    } else {
        const button = activeHeader.querySelector('.btn-srch-switch');
        togglePanel(search, button, false);
        button.focus();
    }
});

function syncScrollHeader() {
    const showCompact = desktop.matches && window.scrollY > 260;
    const nextHeader = showCompact ? compactHeader : mainHeader;
    if (nextHeader === activeHeader) return;

    togglePanel(search, activeHeader.querySelector('.btn-srch-switch'), false);
    setMenuOpen(false);
    activeHeader = nextHeader;
    activeHeader.append(search, menu);
    mainHeader.inert = showCompact;
    shell.classList.toggle('body-sticky', showCompact);
}

window.addEventListener('scroll', syncScrollHeader, { passive: true });
window.addEventListener('pageshow', syncScrollHeader);
desktop.addEventListener('change', syncScrollHeader);
syncScrollHeader();

const date = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
}).formatToParts();
const datePart = (type) => date.find((part) => part.type === type).value;
header.querySelector('.txt-date').textContent = ['year','month','day'].map(datePart).join('.');
header.querySelector('.txt-week').textContent = '(' + datePart('weekday') + ')';

const searchForm = search.querySelector('form');
searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = searchForm.elements.query.value.trim().toLocaleLowerCase('ko');
    const results = search.querySelector('ul');
    results.replaceChildren();
    const unique = new Set();
    if (query) {
        for (const article of document.querySelectorAll('main a[href]')) {
            const title = article.textContent.trim().replace(/\s+/g, ' ');
            if (title.length < 8 || !title.toLocaleLowerCase('ko').includes(query) || unique.has(article.href)) continue;
            unique.add(article.href);
            const link = document.createElement('a');
            link.href = article.href;
            link.textContent = title;
            const item = document.createElement('li');
            item.append(link);
            results.append(item);
            if (unique.size === 8) break;
        }
    }
    search.querySelector('[aria-live]').textContent = unique.size ? '검색 결과 ' + unique.size + '건' : '검색 결과가 없습니다.';
});

for (const carousel of document.querySelectorAll('main .swiper-initialized')) {
    carousel.classList.remove('swiper-initialized', 'swiper-horizontal', 'swiper-backface-hidden');
    const track = carousel.querySelector('.swiper-wrapper');
    track?.removeAttribute('style');
    track?.removeAttribute('id');
    for (const slide of carousel.querySelectorAll('.swiper-slide')) {
        slide.removeAttribute('style');
        slide.classList.remove('swiper-slide-active', 'swiper-slide-next', 'swiper-slide-prev');
    }
    carousel.querySelector('.swiper-notification')?.remove();
}

for (const selector of ['section.issue', '.issue-keyword-list']) {
    new Swiper(selector + ' .swiper-container', { slidesPerView: 'auto' });
}

for (const section of ['banner', 'interactive', 'photoplus', 'video']) {
    new Swiper('.' + section + '-wrap .swiper-container', {
        slidesPerView: 1,
        spaceBetween: 16,
        pagination: { el: '.' + section + '-wrap-pagignation', clickable: true },
    });
}

const topButton = document.querySelector('footer .btn-top');
topButton?.addEventListener('click', () => window.scrollTo({
    top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
}));
