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
async function withPdf(pdf, useDocument) {
    if (!pdf) throw new Error('원본 PDF 없음');
    pdfLibrary ??= import(pdfModule + 'pdf.min.mjs');
    const library = await pdfLibrary.catch(error => { pdfLibrary = undefined; throw error; });
    library.GlobalWorkerOptions.workerSrc = pdfModule + 'pdf.worker.min.mjs';
    const task = library.getDocument({ url: pdf, isEvalSupported: false });
    try {
        const document = await task.promise;
        return await useDocument(document);
    } finally {
        await task.destroy();
    }
}

function withPdfPage(pdf, number, usePage) {
    return withPdf(pdf, async document => usePage(await document.getPage(number)));
}

export function indexPdf(pdf) {
    return withPdf(pdf, async document => {
        const pages = [];
        for (let number = 1; number <= document.numPages; number++) {
            const page = await document.getPage(number);
            const viewport = page.getViewport({ scale: 1 });
            const { items } = await page.getTextContent();
            const runs = items.filter(item => item.str).map(item => {
                const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
                const h = item.height || Math.hypot(item.transform[2], item.transform[3]);
                return [item.str, x * 1000 / viewport.width, (y - .85 * h) * 1000 / viewport.height,
                    item.width * 1000 / viewport.width, h * 1000 / viewport.height];
            });
            pages.push([number, runs]);
            page.cleanup();
        }
        return pages;
    });
}

function cropRegion(pdf, number, points) {
    return withPdfPage(pdf, number, page => renderCrop(page, page.getViewport({ scale: 300 / 72 }), points));
}

function containsPoint(points, x, y) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [x1, y1] = points[i], [x2, y2] = points[j];
        if ((y1 > y) !== (y2 > y) && x < x1 + (x2 - x1) * (y - y1) / (y2 - y1)) inside = !inside;
    }
    return inside;
}

async function readPrintText(selection) {
    const { points, pdf, page, printText, row } = selection;
    if (selection.printBody != null) return selection.printBody.trim() ? { body: selection.printBody } : null;
    if (selection.issue !== 1) return null;
    if (printText) {
        const response = await fetch(printText);
        if (response.ok) {
            const entries = await response.json();
            if (entries[row.article_number]) return entries[row.article_number];
        }
    }
    if (!points || !pdf) return null;
    return withPdfPage(pdf, page, async pdfPage => {
        const viewport = pdfPage.getViewport({ scale: 1 });
        const { items } = await pdfPage.getTextContent({ disableNormalization: true });
        const lines = [];
        let line = '';
        for (const item of items) {
            if (typeof item.str !== 'string') continue;
            const [x, y] = viewport.convertToViewportPoint(item.transform[4] + item.width / 2, item.transform[5] + item.height / 3);
            if (!containsPoint(points, x * 1000 / viewport.width, y * 1000 / viewport.height)) continue;
            if (/^　/.test(item.str) && line.trim()) { lines.push(line.trim()); line = ''; }
            line += item.str;
            if (item.hasEOL) line += '\n';
        }
        if (line.trim()) lines.push(line.trim());
        const body = lines.join('\n\n').trim();
        return body ? { body } : null;
    });
}

function closeBoundary(points) {
    if (points.length < 3) return null;
    const boundary = points.map(point => [...point]);
    const [first, second] = boundary;
    const last = boundary.at(-1), previous = boundary.at(-2);
    const closeVertically = first[0] !== second[0];
    const incomingHorizontal = last[1] === previous[1];
    if (closeVertically === incomingHorizontal) {
        last[closeVertically ? 0 : 1] = first[closeVertically ? 0 : 1];
    } else {
        boundary.push(incomingHorizontal ? [last[0], first[1]] : [first[0], last[1]]);
    }
    return boundary.length <= 64 && orthogonal(boundary) ? boundary : null;
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

export function configureArticleViewer(onOpen, onSave, onMove) {
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
    const toggles = [ui('region-toolbar')];
    const metadata = ui('region-metadata');
    const fields = ui('region-fields');
    const save = ui('region-save');
    const picker = ui('region-article');
    const message = ui('region-status');
    const nextPicker = ui('region-next');
    const printInput = ui('region-print');
    const titleInput = ui('region-title');
    let editing;
    let points = [];
    let sketch;
    let saving = false;
    let closed = false;
    let contexts = [];
    const targets = new Map();
    const nextBadge = ui('linked-article');
    const previousBadge = ui('linked-previous');
    let hovered;
    let pendingClick;
    let printText;
    let textReady = false;
    let onlineReady = false;

    function outline() {
        const preview = closed ? [...points, points[0]] : points;
        sketch?.setAttribute('points', preview.map(point => point.join(',')).join(' '));
        sketch?.classList.toggle('is-closed', closed);
    }

    function stopEditing() {
        editing?.overlay.classList.remove('is-editing');
        sketch?.remove();
        sketch = editing = undefined;
        points = [];
        closed = false;
        form.hidden = true;
        for (const button of toggles) button.setAttribute('aria-expanded', 'false');
    }

    function loadPoints() {
        fields.disabled = save.disabled = !picker.value;
        const article = editing.articles.find(row => row.article_number === Number(picker.value));
        const region = editing.regions.find(entry => String(entry.article) === picker.value);
        metadata.hidden = picker.value === 'new-image' || Boolean(region?.imageOnly);
        points = region ? region.points.map(point => [...point]) : [];
        closed = Boolean(region);
        ui('region-previous').textContent = region?.previous
            ? region.previous.page + '면 · ' + (editing.articles.find(row => row.article_number === region.previous.article)?.title || '')
            : '연결 없음';
        nextPicker.value = region?.next ? region.next.page + ':' + region.next.article : '';
        printInput.value = region?.printBody || '';
        titleInput.value = region?.printTitle || '';
        titleInput.placeholder = article?.title || '';
        if (region && editing.issue === 1 && region.printBody == null && editing.printText) {
            const edit = editing, selectedArticle = picker.value;
            void readPrintText({ ...region, issue: 1, printText: edit.printText, row: { article_number: Number(selectedArticle) } })
                .then(data => { if (editing === edit && picker.value === selectedArticle) {
                    if (!printInput.value) printInput.value = data?.body || '';
                    if (!titleInput.value) titleInput.placeholder = data?.title || titleInput.placeholder;
                } })
                .catch(() => {});
        }
        message.textContent = picker.value && !region ? '지면에서 새 영역을 그리세요.' : '';
        outline();
    }

    function toggleEditor() {
        if (saving) return;
        if (editing) { stopEditing(); return; }
        close(false);
        editing = sheets.find(sheet => sheet.editable && sheet.pdf);
        if (!editing) return;
        editing.overlay.classList.add('is-editing');
        sketch = document.createElementNS(svgNS, 'polyline');
        sketch.setAttribute('class', 'region-sketch');
        editing.overlay.append(sketch);
        const registered = new Set(editing.regions.map(region => region.article));
        picker.replaceChildren(new Option('등록할 영역을 선택하세요', ''), new Option('새 이미지 영역 · 광고 등', 'new-image'),
            ...editing.regions.filter(region => region.imageOnly).map((region, index) => new Option('등록된 이미지 영역 ' + (index + 1), region.article)),
            ...editing.articles.map(row =>
            new Option((registered.has(row.article_number) ? '등록됨 · ' : '') + row.title, row.article_number)));
        nextPicker.replaceChildren(new Option('연결 없음', ''), ...editing.destinations.map(entry =>
            new Option(entry.page + '면 · ' + entry.title, entry.page + ':' + entry.article)));
        form.hidden = false;
        for (const button of toggles) button.setAttribute('aria-expanded', 'true');
        loadPoints();
        picker.focus({ preventScroll: true });
    }
    for (const button of toggles) button.onclick = toggleEditor;
    picker.onchange = loadPoints;
    ui('region-close').onclick = stopEditing;
    ui('region-undo').onclick = () => { closed = false; points.pop(); outline(); };
    ui('region-reset').onclick = () => {
        closed = false;
        points = [];
        message.textContent = '지면에서 새 영역을 그리세요.';
        outline();
    };
    function finishBoundary() {
        const boundary = closeBoundary(points);
        if (!boundary) {
            message.textContent = '가로와 세로로 이어지는 꼭짓점을 더 찍어 주세요.';
            return;
        }
        points = boundary;
        closed = true;
        message.textContent = '영역을 닫았습니다. 저장하거나 점을 다시 조정할 수 있습니다.';
        outline();
    }
    ui('region-finish').onclick = finishBoundary;

    form.onsubmit = async event => {
        event.preventDefault();
        if (saving || !editing || !picker.value) return;
        const sheet = editing;
        const existingImage = sheet.regions.find(region => region.imageOnly && region.article === picker.value);
        const imageOnly = picker.value === 'new-image' || Boolean(existingImage);
        const article = imageOnly ? existingImage?.article || crypto.randomUUID() : Number(picker.value);
        const boundary = closed ? points : closeBoundary(points);
        if (!boundary) {
            message.textContent = '꼭짓점을 네 개 이상 찍어 직각으로 닫히는 영역을 만드세요.';
            return;
        }
        const [nextPage, nextArticle] = nextPicker.value.split(':').map(Number);
        const next = nextPage ? { page: nextPage, article: nextArticle } : null;
        const printBody = printInput.value.trim() || null;
        const printTitle = titleInput.value.trim() || null;
        saving = picker.disabled = fields.disabled = save.disabled = true;
        message.textContent = '원본 PDF에서 PNG를 만드는 중입니다.';
        try {
            const prior = sheet.regions.find(entry => entry.article === article);
            const changed = !prior?.pngPath || JSON.stringify(prior.points) !== JSON.stringify(boundary);
            const bucket = supabase.storage.from('evere-epaper-crops');
            let pngPath = prior?.pngPath;
            if (changed) {
                const png = await cropRegion(sheet.pdf, sheet.page, boundary);
                pngPath = sheet.issue + '/' + sheet.page + '/' + article + '-' + crypto.randomUUID() + '.png';
                const upload = await bucket.upload(pngPath, png, { contentType: 'image/png' });
                if (upload.error) throw upload.error;
            }
            const placement = { issue: sheet.issue, page: sheet.page, points: boundary, png_path: pngPath };
            const saved = imageOnly
                ? await supabase.from('evere_epaper_image_regions').upsert({ ...placement, id: article })
                : await supabase.from('evere_epaper_regions').upsert({
                    ...placement, article_number: article, next_page: next?.page ?? null,
                    next_article: next?.article ?? null, print_body: printBody, print_title: printTitle,
                });
            if (saved.error) {
                if (changed) await bucket.remove([pngPath]);
                throw saved.error;
            }
            if (changed && prior?.pngPath && !prior.pngPath.startsWith('/')) await bucket.remove([prior.pngPath]);
            const regions = [...sheet.regions.filter(entry => entry.article !== article),
                imageOnly ? { article, points: boundary, pngPath, imageOnly } : { article, points: boundary, pngPath, printBody, printTitle, next }];
            onSave(sheet.issue, sheet.page, regions);
        } catch {
            if (editing === sheet) message.textContent = '영역과 PNG를 저장하지 못했습니다. 다시 시도해 주세요.';
        } finally {
            saving = picker.disabled = false;
            fields.disabled = save.disabled = !picker.value;
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

    function placeBadges() {
        const target = targets.get(hovered) || targets.get(selection?.page + ':' + selection?.article);
        const base = stage.getBoundingClientRect();
        for (const [badge, key] of [[previousBadge, 'previous'], [nextBadge, 'next']]) {
            const destination = target?.details[key];
            badge.hidden = !destination || Boolean(editing);
            badge.onclick = destination ? () => onMove(destination) : null;
            if (badge.hidden) continue;
            const rect = target.polygon.getBoundingClientRect();
            badge.style.left = Math.max(0, (key === 'previous' ? rect.left + 8 : rect.right - badge.offsetWidth - 8) - base.left) + 'px';
            badge.style.top = Math.max(0, (key === 'previous' ? rect.top + 6 : rect.bottom - badge.offsetHeight - 6) - base.top) + 'px';
            badge.title = destination.page + '면 연결 기사 보기';
        }
    }
    for (const badge of [previousBadge, nextBadge]) {
        badge.onpointerleave = () => { hovered = undefined; placeBadges(); };
    }
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
        placeBadges();
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
        onOpen(undefined);
        nextBadge.hidden = previousBadge.hidden = true;
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
        download.disabled = !selection?.pngPath;
        print.disabled = tab === 'image' ? !cropUrl : online ? !article : !printText;
        if (tab === 'text') {
            ui('article-title').textContent = selection?.printTitle || printText?.title || selection?.row.title || '';
            ui('article-copy').textContent = printText?.body || '';
            ui('article-subtitle').hidden = true;
            status.textContent = textReady ? printText ? '' : '이 기사에서 읽을 수 있는 지면 텍스트가 없습니다.' : '지면 텍스트를 불러오는 중입니다.';
        }
        if (online) {
            ui('article-title').textContent = article?.title || selection?.row.title || '';
            ui('article-subtitle').textContent = article?.subtitle || '';
            ui('article-subtitle').hidden = !article?.subtitle?.trim();
            const copy = ui('article-copy');
            copy.replaceChildren();
            if (article) renderBody(copy, article, { legacyLineBreaks: true });
            copy.querySelectorAll('figure').forEach(figure => figure.remove());
            status.textContent = onlineReady ? article ? '' : '등록된 온라인 본문이 없습니다.' : '온라인 기사를 불러오는 중입니다.';
        }
        if (tab !== 'image') ui('article-' + tab).append(content);
        ui('online-meta').hidden = !online;
        ui('article-link').hidden = !online;
        if (!selection) return;
        if (tab === 'image' && !cropUrl) {
            const current = job;
            status.textContent = '지면 이미지를 불러오는 중입니다.';
            const image = selection.pngPath ? (async () => {
                const url = selection.pngPath.startsWith('/epaper/files/')
                    ? selection.pngPath : supabase.storage.from('evere-epaper-crops').getPublicUrl(selection.pngPath).data.publicUrl;
                const response = await fetch(url);
                if (!response.ok) throw new Error('PNG 없음');
                return response.blob();
            })() : Promise.reject(new Error('저장된 지면 이미지 없음'));
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
        } else if (tab === 'image') status.textContent = '';
    }

    async function open(next, trigger) {
        const current = ++job;
        article = printText = undefined;
        textReady = onlineReady = false;
        clearCrop();
        selection = next;
        lastTrigger = trigger;
        for (const polygon of layer.querySelectorAll('polygon')) polygon.setAttribute('aria-pressed', String(polygon === trigger));
        onOpen(next.row.article_number);
        panel.inert = false;
        main.classList.add('has-article');
        panel.scrollTop = 0;
        ui('article-title').textContent = next.row.title;
        if (!next.imageOnly) ui('article-link').href = articlePath(next.row);
        ui('article-subtitle').hidden = true;
        ui('online-date').textContent = '';
        ui('online-byline').textContent = '';
        ui('article-copy').replaceChildren();
        status.textContent = '기사를 불러오는 중입니다.';
        ui('tab-text').hidden = ui('tab-online').hidden = Boolean(next.imageOnly);
        const initialTab = next.imageOnly ? 'image' : 'text';
        switchTab(initialTab);
        ui('tab-' + initialTab).focus({ preventScroll: true });
        track(320);
        if (next.imageOnly) return;
        void readPrintText(next).then(result => {
            if (job !== current) return;
            printText = result;
            textReady = true;
            if (activeTab === 'text') switchTab('text');
        }, () => {
            if (job !== current) return;
            textReady = true;
            if (activeTab === 'text') switchTab('text');
        });
        const { data, error } = await supabase.from('evere_articles').select('title,subtitle,body,body_html,published_at,byline_names')
            .eq('article_number', next.row.article_number).eq('status', 'published').maybeSingle();
        if (job !== current) return;
        onlineReady = true;
        if (error || !data) {
            if (activeTab === 'online') switchTab('online');
            return;
        }
        article = data;
        ui('online-date').dateTime = data.published_at || '';
        ui('online-date').textContent = data.published_at ? new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
        }).format(new Date(data.published_at)) : '';
        ui('online-byline').textContent = (data.byline_names || []).join(', ');
        if (activeTab === 'online') switchTab('online');
    }

    function openArticle(row, page = row.print_page) {
        const target = targets.get(page + ':' + row.article_number);
        const sheet = contexts.find(item => item.page === page);
        void open(target?.details || { row, pdf: sheet?.pdf, page, issue: row.print_issue }, target?.polygon).catch(() => {
            status.textContent = '기사를 불러오지 못했습니다.';
        });
    }
    function setSheets(nextSheets) {
        stopEditing();
        clearTimeout(pendingClick);
        nextBadge.hidden = previousBadge.hidden = true;
        hovered = undefined;
        targets.clear();
        contexts = nextSheets;
        const canEdit = nextSheets.some(sheet => sheet.editable && sheet.src && sheet.pdf);
        for (const button of toggles) button.hidden = !canEdit;
        if (selection) close(false);
        sheets = [];
        layer.replaceChildren();
        for (const sheet of nextSheets) {
            const { image, src, pdf, printText, page, issue, regions = [], articles } = sheet;
            if (!src) continue;
            const rows = new Map(articles.map(row => [row.article_number, row]));
            const overlay = document.createElementNS(svgNS, 'svg');
            overlay.setAttribute('viewBox', '0 0 1000 1000');
            overlay.setAttribute('preserveAspectRatio', 'none');
            for (const region of regions) {
                const { article: id, points } = region;
                const row = region.imageOnly ? { title: '지면 이미지' } : rows.get(id);
                if (!row || !orthogonal(points)) continue;
                const polygon = document.createElementNS(svgNS, 'polygon');
                polygon.setAttribute('points', points.map(point => point.join(',')).join(' '));
                polygon.setAttribute('tabindex', '0');
                polygon.setAttribute('role', 'button');
                polygon.setAttribute('aria-label', region.imageOnly ? '지면 이미지 보기' : (region.printTitle || row.title) + ' 기사 보기');
                polygon.setAttribute('aria-pressed', 'false');
                const title = document.createElementNS(svgNS, 'title');
                title.textContent = region.imageOnly ? '지면 이미지 보기' : (region.printTitle || row.title) + ' · 기사 보기';
                polygon.append(title);
                const key = page + ':' + id;
                targets.set(key, { polygon, details: { ...region, row, pdf, printText, page, issue } });
                const select = () => {
                    if (!editing) void open(targets.get(key).details, polygon).catch(() => {
                        status.textContent = '기사를 불러오지 못했습니다.';
                    });
                };
                polygon.addEventListener('click', event => {
                    clearTimeout(pendingClick);
                    if (event.detail < 2) pendingClick = setTimeout(select, 250);
                });
                polygon.addEventListener('pointerenter', () => {
                    if (editing) return;
                    hovered = key;
                    placeBadges();
                });
                polygon.addEventListener('pointerleave', event => {
                    if (event.relatedTarget?.closest?.('.viewer-linked-badge')) return;
                    hovered = undefined;
                    placeBadges();
                });
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
                if (editing !== visibleSheet || saving || !picker.value || closed || points.length >= 63) return;
                const rect = overlay.getBoundingClientRect();
                const x = Math.round(1000 * (event.clientX - rect.left) / rect.width);
                const y = Math.round(1000 * (event.clientY - rect.top) / rect.height);
                if (points.length >= 3 && Math.abs((x - points[0][0]) * rect.width / 1000) < 14 &&
                    Math.abs((y - points[0][1]) * rect.height / 1000) < 14) {
                    finishBoundary();
                    return;
                }
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

    for (const tab of tabs) {
        tab.onclick = () => switchTab(tab.dataset.articleTab);
        tab.onkeydown = event => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            event.stopPropagation();
            const visibleTabs = tabs.filter(button => !button.hidden);
            const visibleIndex = visibleTabs.indexOf(tab);
            switchTab(visibleTabs[(visibleIndex + step + visibleTabs.length) % visibleTabs.length].dataset.articleTab, true);
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
    download.onclick = async () => {
        if (!selection?.pngPath) return;
        const { pngPath, row } = selection;
        const url = pngPath.startsWith('/epaper/files/') ? pngPath :
            supabase.storage.from('evere-epaper-crops').getPublicUrl(pngPath).data.publicUrl;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('PNG 없음');
            const link = document.createElement('a');
            link.href = URL.createObjectURL(await response.blob());
            link.download = row.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 100) + '.png';
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        } catch {
            status.textContent = '이미지를 다운로드하지 못했습니다.';
        }
    };
    print.onclick = () => {
        if (print.disabled) return;
        main.classList.add('print-article');
        try { window.print(); } finally { main.classList.remove('print-article'); }
    };
    return { setSheets, track, openArticle, closeArticle: () => { if (selection) close(false); }, closeEditor: stopEditing, isEditing: () => Boolean(editing) };
}
