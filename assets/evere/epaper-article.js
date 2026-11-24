import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { renderBody } from './article-content.js?v=paragraph-breaks-2';

const svgNS = 'http://www.w3.org/2000/svg';
const ui = id => document.getElementById('epaper-' + id);

function orthogonal(points) {
    if (!Array.isArray(points) || points.length < 4 || points.length % 2) return false;
    if (!points.every(point => Array.isArray(point) && point.length === 2 &&
        point.every(value => Number.isFinite(value) && value >= 0 && value <= 1000))) return false;
    const axes = points.map(([x, y], index) => {
        const [nx, ny] = points[(index + 1) % points.length];
        return x === nx && y !== ny ? 'y' : y === ny && x !== nx ? 'x' : '';
    });
    return axes.every((axis, index) => axis && axis !== axes[(index + 1) % axes.length]);
}

async function cropRegion(src, points) {
    const image = new Image();
    image.src = src;
    await image.decode();
    const coordinates = points.map(([x, y]) => [x * image.naturalWidth / 1000, y * image.naturalHeight / 1000]);
    const xs = coordinates.map(point => point[0]);
    const ys = coordinates.map(point => point[1]);
    const x = Math.floor(Math.min(...xs));
    const y = Math.floor(Math.min(...ys));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(Math.max(...xs)) - x;
    canvas.height = Math.ceil(Math.max(...ys)) - y;
    const context = canvas.getContext('2d');
    context.beginPath();
    coordinates.forEach(([px, py], index) => {
        if (index === 0) context.moveTo(px - x, py - y);
        else context.lineTo(px - x, py - y);
    });
    context.closePath();
    context.clip();
    context.drawImage(image, -x, -y);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 생성 실패')), 'image/png'));
}

export function configureArticleViewer(onOpen) {
    const layer = ui('hotspots');
    const panel = ui('article-panel');
    const main = panel.closest('.viewer-main');
    const stage = ui('stage');
    const scroll = ui('image-scroll');
    const status = ui('article-status');
    const download = ui('article-download');
    const print = ui('article-print');
    const frame = ui('article-frame');
    const crop = ui('article-crop');
    const tabs = [...panel.querySelectorAll('[data-article-tab]')];
    let sheets = [];
    let selection;
    let article;
    let activeTab = 'text';
    let job = 0;
    let cropUrl = '';
    let frameRequest = 0;
    let trackUntil = 0;
    let fontSize = 17;
    let lastTrigger;

    function layout() {
        frameRequest = 0;
        const base = stage.getBoundingClientRect();
        for (const { image, overlay } of sheets) {
            const bounds = image.getBoundingClientRect();
            if (!image.naturalWidth || image.hidden) { overlay.style.display = 'none'; continue; }
            const ratio = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
            const width = image.naturalWidth * ratio;
            const height = image.naturalHeight * ratio;
            Object.assign(overlay.style, {
                display: '',
                left: bounds.left - base.left + (bounds.width - width) / 2 + 'px',
                top: bounds.top - base.top + 'px',
                width: width + 'px', height: height + 'px',
            });
        }
        if (performance.now() < trackUntil) schedule();
    }

    function schedule() {
        if (!frameRequest) frameRequest = requestAnimationFrame(layout);
    }

    function track(duration) {
        trackUntil = Math.max(trackUntil, performance.now() + duration);
        schedule();
    }

    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    for (const image of scroll.querySelectorAll('img')) image.addEventListener('load', schedule);

    function clearCrop() {
        if (cropUrl) URL.revokeObjectURL(cropUrl);
        cropUrl = '';
        crop.removeAttribute('src');
    }

    function close(restoreFocus = true) {
        job++;
        selection = undefined;
        article = undefined;
        clearCrop();
        if (frame.hasAttribute('src')) frame.removeAttribute('src');
        panel.inert = true;
        main.classList.remove('has-article');
        layer.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
        if (restoreFocus) lastTrigger?.focus({ preventScroll: true });
        lastTrigger = undefined;
        track(320);
    }

    function switchTab(tab, focus = false) {
        activeTab = tab;
        for (const button of tabs) {
            const active = button.dataset.articleTab === tab;
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
            if (active && focus) button.focus();
        }
        download.disabled = tab === 'online' || (tab === 'text' && !article) || (tab === 'image' && !cropUrl);
        print.disabled = download.disabled;
        if (!selection) return;
        if (tab === 'online' && !frame.hasAttribute('src')) frame.src = articlePath(selection.row);
        if (tab === 'image' && !cropUrl) {
            const current = job;
            status.textContent = '지면 이미지를 불러오는 중입니다.';
            void cropRegion(selection.src, selection.points).then(blob => {
                if (job !== current) return;
                clearCrop();
                cropUrl = URL.createObjectURL(blob);
                crop.src = cropUrl;
                crop.alt = selection.row.title + ' 지면 이미지';
                if (activeTab === 'image') {
                    status.textContent = '';
                    download.disabled = false;
                    print.disabled = false;
                }
            }, () => {
                if (job === current && activeTab === 'image') status.textContent = '지면 이미지를 만들지 못했습니다.';
            });
        } else if (tab !== 'text' || article) status.textContent = '';
    }

    async function open(next, trigger) {
        const current = ++job;
        article = undefined;
        clearCrop();
        if (frame.hasAttribute('src')) frame.removeAttribute('src');
        selection = next;
        lastTrigger = trigger;
        for (const polygon of layer.querySelectorAll('polygon')) polygon.setAttribute('aria-pressed', String(polygon === trigger));
        onOpen();
        panel.inert = false;
        main.classList.add('has-article');
        panel.scrollTop = 0;
        ui('article-title').textContent = next.row.title;
        ui('article-link').href = articlePath(next.row);
        ui('article-subtitle').hidden = true;
        ui('article-copy').replaceChildren();
        status.textContent = '기사를 불러오는 중입니다.';
        switchTab('text');
        ui('tab-text').focus({ preventScroll: true });
        track(320);
        const { data, error } = await supabase.from('evere_articles').select('title,subtitle,body,body_html')
            .eq('article_number', next.row.article_number).eq('status', 'published').maybeSingle();
        if (job !== current) return;
        if (error || !data) {
            if (activeTab === 'text') status.textContent = '기사를 불러오지 못했습니다.';
            return;
        }
        article = data;
        ui('article-title').textContent = data.title;
        ui('article-subtitle').textContent = data.subtitle || '';
        ui('article-subtitle').hidden = !data.subtitle?.trim();
        const copy = ui('article-copy');
        renderBody(copy, data, { legacyLineBreaks: true });
        copy.querySelectorAll('figure').forEach(figure => figure.remove());
        if (activeTab === 'text') {
            status.textContent = '';
            download.disabled = false;
            print.disabled = false;
        }
    }

    function setSheets(nextSheets) {
        if (selection) close(false);
        sheets = [];
        layer.replaceChildren();
        for (const { image, src, regions, articles } of nextSheets) {
            if (!src || !regions?.length) continue;
            const rows = new Map(articles.map(row => [row.article_number, row]));
            const overlay = document.createElementNS(svgNS, 'svg');
            overlay.setAttribute('viewBox', '0 0 1000 1000');
            overlay.setAttribute('preserveAspectRatio', 'none');
            for (const { article: id, points } of regions) {
                const row = rows.get(id);
                if (!row || !orthogonal(points)) continue;
                const polygon = document.createElementNS(svgNS, 'polygon');
                polygon.setAttribute('points', points.map(point => point.join(',')).join(' '));
                polygon.setAttribute('tabindex', '0');
                polygon.setAttribute('role', 'button');
                polygon.setAttribute('aria-label', row.title + ' 연결 기사 보기');
                polygon.setAttribute('aria-pressed', 'false');
                const title = document.createElementNS(svgNS, 'title');
                title.textContent = row.title + ' · 연결 기사 보기';
                polygon.append(title);
                const select = () => void open({ row, points, src }, polygon).catch(() => {
                    status.textContent = '기사를 불러오지 못했습니다.';
                });
                polygon.addEventListener('click', select);
                polygon.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        select();
                    }
                });
                overlay.append(polygon);
            }
            layer.append(overlay);
            sheets.push({ image, overlay });
        }
        schedule();
    }

    for (const [index, tab] of tabs.entries()) {
        tab.onclick = () => switchTab(tab.dataset.articleTab);
        tab.onkeydown = event => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            event.stopPropagation();
            switchTab(tabs[(index + step + tabs.length) % tabs.length].dataset.articleTab, true);
        };
    }
    ui('article-close').onclick = () => close();
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    for (const [id, step] of [['type-up', 1], ['type-down', -1]]) {
        ui(id).onclick = () => {
            fontSize = Math.max(13, Math.min(25, fontSize + step));
            ui('article-copy').style.setProperty('--article-text-size', fontSize + 'px');
        };
    }
    download.onclick = () => {
        if (!selection || download.disabled) return;
        const name = selection.row.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 100);
        const link = document.createElement('a');
        const text = activeTab === 'text';
        link.href = text ? URL.createObjectURL(new Blob(
            [[article.title, article.subtitle, article.body].filter(Boolean).join('\n\n')],
            { type: 'text/plain;charset=utf-8' },
        )) : cropUrl;
        link.download = name + (text ? '.txt' : '.png');
        link.click();
        if (text) setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    print.onclick = () => {
        if (print.disabled) return;
        main.classList.add('print-article');
        try { window.print(); } finally { main.classList.remove('print-article'); }
    };
    return { setSheets, track };
}
