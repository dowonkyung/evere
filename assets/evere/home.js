const header = document.querySelector('#evere-header').shadowRoot;
void import('./supabase.js').then(({ supabase }) => {
    const links = [...header.querySelectorAll('a.login01[href="/account/"]')];
    const mark = session => {
        for (const link of links) {
            link.setAttribute('aria-label', session ? '마이페이지' : '로그인');
            if (session) link.style.backgroundImage = 'url("/assets/evere/account-signed-in.svg")';
            else link.style.removeProperty('background-image');
        }
    };
    supabase.auth.onAuthStateChange((_event, session) => mark(session));
}).catch(() => {});
const shell = header.querySelector('.yna-shell');
const mainHeader = header.querySelector('.wrap-header02');
const compactHeader = header.querySelector('.wrap-header21');
const compactMobileLogo = compactHeader?.querySelector('.logo-yna03 img');
if (compactMobileLogo) compactMobileLogo.src = '/assets/evere/logo.svg';
const search = header.querySelector('.evere-search');
const menu = header.querySelector('.evere-category-popup');
const menuDim = header.querySelector('.evere-category-dim');
const closeMenu = menu.querySelector('[data-close-sitemap]');
const desktop = matchMedia('(min-width: 1024px)');
const mobileCategory = matchMedia('(max-width: 767px)');
const reduceMenuMotion = matchMedia('(prefers-reduced-motion: reduce)');
const categoryAnimations = new WeakMap();
const categoryButtons = [...menu.querySelectorAll('[data-category-toggle]')];
const expandCategories = menu.querySelector('[data-expand-categories]');
expandCategories.setAttribute('aria-controls', categoryButtons.map(button => button.getAttribute('aria-controls')).join(' '));
let activeHeader = mainHeader || compactHeader;
let menuOpen = false;
let menuMotion;
let dimMotion;
menu.inert = true;

const category = menu.querySelector('.wrap.category');
const utility = document.createElement('div');
utility.className = 'etc';
const partners = category.querySelector('.category-partners');
if (partners) utility.append(partners);
const services = document.createElement('ul');
services.className = 'category-services';
services.setAttribute('aria-label', '이브레 서비스');
for (const name of ['구독신청', '기사제보', '지면보기', 'RSS', '알림']) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = name;
    item.append(label);
    services.append(item);
}
utility.append(services);
category.append(utility);

function togglePanel(panel, button, open) {
    panel.hidden = !open;
    menuDim.hidden = search.hidden && menu.hidden;
    shell.classList.toggle('evere-search-open', !search.hidden);
    setPanelButton(button, open);
}

function setPanelButton(button, open) {
    button.classList.toggle('active', open);
    button.setAttribute('aria-expanded', String(open));
    button.querySelector('.ir-txt01').textContent =
        button.dataset.a11yTxt.split(';')[open ? 0 : 1];
}

function setMenuOpen(open, section, animate = true) {
    const button = activeHeader.querySelector('button.menu01');
    const changed = menuOpen !== open;
    const slide = changed && animate && !reduceMenuMotion.matches && typeof menu.animate === 'function';
    const full = 'inset(0% 0 0% 0)';
    const closed = 'inset(0% 0 100% 0)';
    const from = menuMotion ? getComputedStyle(menu).clipPath : open ? closed : full;
    if (changed || !animate) {
        const dimFrom = dimMotion ? getComputedStyle(menuDim).opacity : menuDim.hidden ? 0 : 1;
        menuMotion?.cancel();
        dimMotion?.cancel();
        menuMotion = dimMotion = null;
        menuOpen = open;
        menu.inert = !open;
        setPanelButton(button, open);
        const finish = () => {
            menu.hidden = !open;
            menu.classList.toggle('active', open);
            menuDim.hidden = search.hidden && menu.hidden;
            document.documentElement.classList.toggle('evere-sitemap-open', open);
        };
        if (open || slide) {
            menu.hidden = false;
            menu.classList.add('active');
            menuDim.hidden = false;
            document.documentElement.classList.add('evere-sitemap-open');
        }
        if (slide) {
            const timing = { duration: 200, easing: 'ease-in-out' };
            const animation = menu.animate([{ clipPath: from }, { clipPath: open ? full : closed }], timing);
            menuMotion = animation;
            if (search.hidden) dimMotion = menuDim.animate([{ opacity: dimFrom }, { opacity: open ? 1 : 0 }], timing);
            animation.onfinish = () => {
                if (menuMotion !== animation) return;
                menuMotion = dimMotion = null;
                finish();
            };
        } else {
            finish();
        }
    }
    if (open) {
        menu.scrollTop = 0;
        const title = section ? menu.querySelector('#sitemap-' + section + ' dt') : null;
        if (title && mobileCategory.matches) {
            const toggle = title.querySelector('[data-category-toggle]');
            if (toggle) setCategoryExpanded(toggle, true);
            updateExpandCategories();
        }
        const focusTarget = title || (mobileCategory.matches ? closeMenu : menu);
        focusTarget.focus({ preventScroll: true });

        if (title && mobileCategory.matches) {
            const top = title.getBoundingClientRect().top - menu.getBoundingClientRect().top;
            menu.scrollTop = Math.max(0, top - menu.querySelector('.title-m').offsetHeight);
        }
    }
}

for (const container of [mainHeader, compactHeader].filter(Boolean)) {
    const searchToggle = container.querySelector('.btn-srch-switch');
    const menuToggle = container.querySelector('button.menu01');

    searchToggle.addEventListener('click', () => {
        togglePanel(search, searchToggle, search.hidden);
        setMenuOpen(false);
        if (!search.hidden) search.querySelector('input').focus();
    });

    menuToggle.addEventListener('click', () => {
        togglePanel(search, searchToggle, false);
        setMenuOpen(!menuOpen);
    });

    container.querySelector('.evere-news-links').addEventListener('click', (event) => {
        const link = event.target.closest('[data-sitemap-section]');
        if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        togglePanel(search, searchToggle, false);
        setMenuOpen(true, link.dataset.sitemapSection);
    });
}

function setCategoryExpanded(button, expanded, animate = false) {
    const panel = button.closest('dt').nextElementSibling;
    const state = String(expanded);
    if (animate && button.getAttribute('aria-expanded') === state) return;
    const slide = animate && mobileCategory.matches && !reduceMenuMotion.matches && panel?.animate;
    const from = slide ? panel.getBoundingClientRect().height : 0;
    button.setAttribute('aria-expanded', state);
    if (!panel) return;

    categoryAnimations.get(panel)?.cancel();
    panel.classList.toggle('category-collapsed', !expanded);
    panel.classList.toggle('category-sliding', Boolean(slide));
    if (!slide) {
        categoryAnimations.delete(panel);
        return;
    }

    const to = expanded ? panel.getBoundingClientRect().height : 0;
    const animation = panel.animate(
        [{ height: from + 'px' }, { height: to + 'px' }],
        { duration: 200, easing: 'ease-in-out' },
    );
    categoryAnimations.set(panel, animation);
    animation.onfinish = () => {
        if (categoryAnimations.get(panel) !== animation) return;
        panel.classList.remove('category-sliding');
        categoryAnimations.delete(panel);
    };
}

function updateExpandCategories() {
    const expanded = categoryButtons.every((button) => button.getAttribute('aria-expanded') === 'true');
    expandCategories.setAttribute('aria-expanded', String(expanded));
    expandCategories.textContent = expanded ? '메뉴 접기' : '메뉴 펼치기';
}

for (const button of categoryButtons) {
    const title = button.closest('dt');
    const link = title.querySelector('a');
    setCategoryExpanded(button, button.getAttribute('aria-expanded') === 'true');

    function toggleCategory(event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        setCategoryExpanded(button, button.getAttribute('aria-expanded') !== 'true', true);
        updateExpandCategories();
    }

    button.addEventListener('click', toggleCategory);

    const list = title.nextElementSibling?.querySelector('ul');
    if (link && list) {
        const item = document.createElement('li');
        const all = link.cloneNode(false);
        all.textContent = '전체';
        item.className = 'category-mobile-all';
        item.append(all);
        list.prepend(item);
        link.addEventListener('click', event => {
            if (mobileCategory.matches) toggleCategory(event);
        });
    }
}

expandCategories.addEventListener('click', () => {
    const open = expandCategories.getAttribute('aria-expanded') !== 'true';
    for (const button of categoryButtons) setCategoryExpanded(button, open, true);
    updateExpandCategories();
});

function closeCategoryMenu() {
    setMenuOpen(false);
    activeHeader.querySelector('button.menu01').focus({ preventScroll: true });
}

closeMenu.addEventListener('click', closeCategoryMenu);
menuDim.addEventListener('click', () => {
    if (menuOpen) {
        closeCategoryMenu();
    } else if (!search.hidden) {
        const button = activeHeader.querySelector('.btn-srch-switch');
        togglePanel(search, button, false);
        button.focus({ preventScroll: true });
    }
});
menu.addEventListener('click', (event) => {
    if (!event.defaultPrevented && event.target.closest('a[href]')) setMenuOpen(false);
});

document.querySelector('footer .info a[title="사이트맵"]')?.addEventListener('click', (event) => {
    event.preventDefault();
    setMenuOpen(true);
});

document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return;
    if (menuOpen && !event.composedPath().includes(header.host)) setMenuOpen(false);
});

header.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || (search.hidden && !menuOpen)) return;
    if (menuOpen) {
        setMenuOpen(false);
        activeHeader.querySelector('button.menu01').focus({ preventScroll: true });
    } else {
        const button = activeHeader.querySelector('.btn-srch-switch');
        togglePanel(search, button, false);
        button.focus();
    }
});

function syncScrollHeader() {
    if (!mainHeader) return;
    const showCompact = desktop.matches && window.scrollY > 260;
    const nextHeader = showCompact ? compactHeader : mainHeader;
    if (nextHeader === activeHeader) return;

    togglePanel(search, activeHeader.querySelector('.btn-srch-switch'), false);
    setMenuOpen(false, undefined, false);
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
const dateLabel = header.querySelector('.txt-date');
if (dateLabel) dateLabel.textContent = ['year','month','day'].map(datePart).join('.');
const weekLabel = header.querySelector('.txt-week');
if (weekLabel) weekLabel.textContent = '(' + datePart('weekday') + ')';

const searchForm = search.querySelector('form');
searchForm.action = '/search/';
searchForm.elements.query.placeholder = '검색어를 입력해 주세요';
searchForm.elements.query.maxLength = 120;
searchForm.querySelector('button').setAttribute('aria-label', '검색');
searchForm.addEventListener('submit', event => {
    const input = searchForm.elements.query;
    input.value = input.value.trim();
    if (!input.value) {
        event.preventDefault();
        input.focus();
    }
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
    globalThis.Swiper && new Swiper(selector + ' .swiper-container', { slidesPerView: 'auto' });
}

for (const section of ['banner', 'interactive', 'photoplus', 'video']) {
    globalThis.Swiper && new Swiper('.' + section + '-wrap .swiper-container', {
        slidesPerView: 1,
        spaceBetween: 16,
        pagination: { el: '.' + section + '-wrap-pagignation', clickable: true },
    });
}

const topButton = document.querySelector('footer .btn-top');
topButton?.addEventListener('click', () => window.scrollTo({
    top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
}));
