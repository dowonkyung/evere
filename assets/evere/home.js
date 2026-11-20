const header = document.querySelector('#evere-header').shadowRoot;
const search = header.querySelector('.evere-search');
const menu = header.querySelector('.evere-menu');
const searchToggle = header.querySelector('.btn-srch-switch');
const menuToggle = header.querySelector('.menu01');

function togglePanel(panel, button, open) {
    panel.hidden = !open;
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
    button.querySelector('.ir-txt01').textContent =
        button.dataset.a11yTxt.split(';')[open ? 0 : 1];
}

searchToggle.addEventListener('click', () => {
    togglePanel(search, searchToggle, search.hidden);
    togglePanel(menu, menuToggle, false);
    if (!search.hidden) search.querySelector('input').focus();
});

menuToggle.addEventListener('click', () => {
    togglePanel(menu, menuToggle, menu.hidden);
    togglePanel(search, searchToggle, false);
    if (!menu.hidden) menu.querySelector('a')?.focus();
});

header.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const button = !search.hidden ? searchToggle : !menu.hidden ? menuToggle : null;
    if (!button) return;
    togglePanel(search, searchToggle, false);
    togglePanel(menu, menuToggle, false);
    button.focus();
});

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
