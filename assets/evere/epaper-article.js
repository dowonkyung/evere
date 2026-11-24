import { supabase } from './supabase.js';
import { articlePath } from './routes.js?v=routes-1';
import { renderBody } from './article-content.js?v=paragraph-breaks-2';

const orthogonalCoordinate = point => point.every(value => value >= 0 && value <= 1000);
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

const pdfModule = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let pdfLibrary;
async function cropRegion(pdf, number, points) {
    if (!pdf) throw new Error('원본 PDF 없음');
    pdfLibrary ??= import(pdfModule + 'pdf.min.mjs');
    const library = await pdfLibrary.catch(error => { pdfLibrary = undefined; throw error; });
    library.GlobalWorkerOptions.workerSrc = pdfModule + 'pdf.worker.min.mjs';
    const task = library.getDocument({ url: pdf, isEvalSupported: false });
    try {
        const document = await task.promise;
        const page = await document.getPage(number);
        const viewport = page.getViewport({ scale: 300 / 72 });
        return await renderCrop(page, viewport, points);
    } finally {
        await task.destroy();
    }
}

async function renderCrop(page, viewport, points) {
    const coordinates = points.map(([x, y]) => [x * viewport.width / 1000, y * viewport.height / 1000]);
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
    const source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    await page.render({ canvasContext: source.getContext('2d'), viewport, transform: [1, 0, 0, 1, -x, -y] }).promise;
    context.drawImage(source, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 생성 실패')), 'image/png'));
}

export function configureArticleViewer(onOpen, onSave) {
    const layer = ui('hotspots');
    const panel = ui('article-panel');
    const main = panel.closest('.viewer-main');
    const stage = ui('stage');
    const scroll = ui('image-scroll');
    const status = ui('article-status');
    const download = ui('article-download');
    const print = ui('article-print');
    const content = ui('article-content');
    const form = ui('region-form');
    const toggle = ui('region-toggle');
    const picker = ui('region-article');
    const message = ui('region-status');
    let editing;
    let points = [];
    let sketch;
    let saving = false;

    function outline() {
        sketch?.setAttribute('points', points.map(point => point.join(',')).join(' '));
    }

    function stopEditing() {
        editing?.overlay.classList.remove('is-editing');
        sketch?.remove();
        sketch = editing = undefined;
        points = [];
        form.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    }

    function loadPoints() {
        const region = editing.regions.find(entry => entry.article === Number(picker.value));
        points = region ? region.points.map(point => [...point]) : [];
        message.textContent = '';
        outline();
    }

    toggle.onclick = () => {
        if (editing) { stopEditing(); return; }
        close(false);
        editing = sheets.find(sheet => sheet.editable && sheet.pdf && sheet.articles.length);
        if (!editing) return;
        editing.overlay.classList.add('is-editing');
        sketch = document.createElementNS(svgNS, 'polyline');
        sketch.setAttribute('class', 'region-sketch');
        editing.overlay.append(sketch);
        picker.replaceChildren(...editing.articles.map(row => new Option(row.title, row.article_number)));
        form.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        loadPoints();
        picker.focus();
    };
    picker.onchange = loadPoints;
    ui('region-close').onclick = stopEditing;
    ui('region-undo').onclick = () => { points.pop(); outline(); };
    ui('region-reset').onclick = () => { points = []; outline(); };

    form.onsubmit = async event => {
        event.preventDefault();
        if (saving || !editing) return;
        const sheet = editing;
        const article = Number(picker.value);
        const boundary = points.map(point => [...point]);
        const first = boundary[0];
        const last = boundary.at(-1);
        if (boundary.length >= 3 && first[0] !== last[0] && first[1] !== last[1]) {
            const previous = boundary.at(-2);
            boundary.push(previous[0] === last[0] ? [first[0], last[1]] : [last[0], first[1]]);
        }
        if (boundary.length > 64 || !orthogonal(boundary)) {
            message.textContent = '꼭짓점을 네 개 이상 찍어 직각으로 닫히는 영역을 만드세요.';
            return;
        }
        saving = true;
        message.textContent = '원본 PDF에서 PNG를 만드는 중입니다.';
        try {
            const png = await cropRegion(sheet.pdf, sheet.page, boundary);
            const bucket = supabase.storage.from('evere-epaper-crops');
            const pngPath = sheet.issue + '/' + sheet.page + '/' + article + '-' + crypto.randomUUID() + '.png';
            const upload = await bucket.upload(pngPath, png, { contentType: 'image/png' });
            if (upload.error) throw upload.error;
            const saved = await supabase.from('evere_epaper_regions').upsert({
                issue: sheet.issue, page: sheet.page, article_number: article, points: boundary, png_path: pngPath,
            });
            if (saved.error) {
                await bucket.remove([pngPath]);
                throw saved.error;
            }
            const prior = sheet.regions.find(entry => entry.article === article);
            if (prior?.pngPath) await bucket.remove([prior.pngPath]);
            sheet.regions = [...sheet.regions.filter(entry => entry.article !== article), { article, points: boundary, pngPath }];
            onSave(sheet.issue, sheet.page, sheet.regions);
            if (editing === sheet) setSheets(sheets);
        } catch {
            if (editing === sheet) message.textContent = '영역과 PNG를 저장하지 못했습니다. 다시 시도해 주세요.';
        } finally {
            saving = false;
        }
    };
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
        const online = tab === 'online';
        if (tab !== 'image') ui('article-' + tab).append(content);
        ui('online-meta').hidden = !online;
        ui('article-link').hidden = !online;
        download.disabled = tab === 'image' ? !cropUrl : !article;
        print.disabled = download.disabled;
        if (!selection) return;
        if (tab === 'image' && !cropUrl) {
            const current = job;
            status.textContent = '지면 이미지를 불러오는 중입니다.';
            const image = selection.pngPath ? (async () => {
                const { data } = supabase.storage.from('evere-epaper-crops').getPublicUrl(selection.pngPath);
                const response = await fetch(data.publicUrl);
                if (!response.ok) throw new Error('PNG 없음');
                return response.blob();
            })() : cropRegion(selection.pdf, selection.page, selection.points);
            void image.then(blob => {
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
        } else if (article || tab === 'image') status.textContent = '';
    }

    async function open(next, trigger) {
        const current = ++job;
        article = undefined;
        clearCrop();
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
        ui('online-date').textContent = '';
        ui('online-byline').textContent = '';
        ui('article-copy').replaceChildren();
        status.textContent = '기사를 불러오는 중입니다.';
        switchTab('text');
        ui('tab-text').focus({ preventScroll: true });
        track(320);
        const { data, error } = await supabase.from('evere_articles').select('title,subtitle,body,body_html,published_at,byline_names')
            .eq('article_number', next.row.article_number).eq('status', 'published').maybeSingle();
        if (job !== current) return;
        if (error || !data) {
            if (activeTab !== 'image') status.textContent = '기사를 불러오지 못했습니다.';
            return;
        }
        article = data;
        ui('online-date').dateTime = data.published_at || '';
        ui('online-date').textContent = data.published_at ? new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
        }).format(new Date(data.published_at)) : '';
        ui('online-byline').textContent = (data.byline_names || []).join(', ');
        ui('article-title').textContent = data.title;
        ui('article-subtitle').textContent = data.subtitle || '';
        ui('article-subtitle').hidden = !data.subtitle?.trim();
        const copy = ui('article-copy');
        renderBody(copy, data, { legacyLineBreaks: true });
        copy.querySelectorAll('figure').forEach(figure => figure.remove());
        if (activeTab !== 'image') {
            status.textContent = '';
            download.disabled = false;
            print.disabled = false;
        }
    }

    function setSheets(nextSheets) {
        stopEditing();
        toggle.hidden = !nextSheets.some(sheet => sheet.editable && sheet.src && sheet.pdf && sheet.articles.length);
        if (selection) close(false);
        sheets = [];
        layer.replaceChildren();
        for (const sheet of nextSheets) {
            const { image, src, pdf, page, regions = [], articles } = sheet;
            if (!src) continue;
            const rows = new Map(articles.map(row => [row.article_number, row]));
            const overlay = document.createElementNS(svgNS, 'svg');
            overlay.setAttribute('viewBox', '0 0 1000 1000');
            overlay.setAttribute('preserveAspectRatio', 'none');
            for (const { article: id, points, pngPath } of regions) {
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
                const select = () => {
                    if (editing) return;
                    void open({ row, points, pdf, page, pngPath }, polygon).catch(() => {
                        status.textContent = '기사를 불러오지 못했습니다.';
                    });
                };
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
            const visibleSheet = { ...sheet, overlay };
            overlay.addEventListener('click', event => {
                if (editing !== visibleSheet || saving || points.length >= 63) return;
                const rect = overlay.getBoundingClientRect();
                const x = Math.round(1000 * (event.clientX - rect.left) / rect.width);
                const y = Math.round(1000 * (event.clientY - rect.top) / rect.height);
                const last = points.at(-1);
                if (!last) points.push([x, y]);
                else {
                    const previous = points.at(-2);
                    const horizontal = previous ? previous[0] === last[0] : Math.abs(x - last[0]) >= Math.abs(y - last[1]);
                    const next = horizontal ? [x, last[1]] : [last[0], y];
                    if (orthogonalCoordinate(next) && (next[0] !== last[0] || next[1] !== last[1])) points.push(next);
                }
                outline();
            });
            sheets.push(visibleSheet);
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
        const text = activeTab !== 'image';
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
