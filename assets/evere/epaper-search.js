const ui = name => document.getElementById('epaper-' + name);
const ns = 'http://www.w3.org/2000/svg';
const fold = text => text.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s/gu, '');

function findMatches(pages, query) {
    const matches = [];
    for (const [page, runs] of pages) {
        let text = '';
        const boxes = [];
        for (const [raw, x, y, w, h] of runs) {
            const characters = Array.from(raw);
            const step = w / characters.length;
            for (const [i, character] of characters.entries()) {
                const normalized = fold(character);
                text += normalized;
                for (let j = 0; j < normalized.length; j++) boxes.push([x + i * step, y, step, h]);
            }
        }
        for (let index = text.indexOf(query); index >= 0; index = text.indexOf(query, index + query.length)) {
            matches.push({ page, boxes: boxes.slice(index, index + query.length),
                before: text.slice(Math.max(0, index - 26), index), hit: text.slice(index, index + query.length),
                after: text.slice(index + query.length, index + query.length + 28) });
        }
    }
    return matches;
}

export function configurePrintSearch(indexPdf, getCurrent, jumpTo, trackReader) {
    const stage = ui('stage');
    const layer = ui('search-marks');
    const scroll = ui('image-scroll');
    const results = ui('search-results');
    const output = ui('search-status');
    const images = [ui('image'), ui('second-image')];
    const cache = new Map();
    let issue, pdf, visible = false, pages = [], matches = [], selected = -1, job = 0, frame = 0, trackUntil = 0;

    function draw() {
        frame = 0;
        layer.replaceChildren();
        if (!visible) return;
        const base = stage.getBoundingClientRect();
        for (const [i, number] of pages.entries()) {
            const image = images[i];
            if (!number || image.hidden || !image.naturalWidth) continue;
            const rect = image.getBoundingClientRect();
            const ratio = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
            const width = image.naturalWidth * ratio;
            const height = image.naturalHeight * ratio;
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('viewBox', '0 0 1000 1000');
            svg.setAttribute('preserveAspectRatio', 'none');
            Object.assign(svg.style, { left: rect.left - base.left + (rect.width - width) / 2 + 'px',
                top: rect.top - base.top + 'px', width: width + 'px', height: height + 'px' });
            for (const [index, match] of matches.entries()) {
                if (match.page !== number) continue;
                for (const [x,y,w,h] of match.boxes) {
                    const box = document.createElementNS(ns, 'rect');
                    box.setAttribute('x', x);
                    box.setAttribute('y', y);
                    box.setAttribute('width', Math.max(w, .5));
                    box.setAttribute('height', h);
                    if (selected === index) box.classList.add('is-selected');
                    svg.append(box);
                }
            }
            layer.append(svg);
        }
        if (performance.now() < trackUntil) schedule();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
    function track() { trackUntil = performance.now() + 350; schedule(); }
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    for (const image of images) {
        observer.observe(image);
        image.addEventListener('load', schedule);
    }
    scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    function select(index, zoom = false) {
        selected = index;
        for (const button of results.querySelectorAll('button')) {
            button.toggleAttribute('data-active', Number(button.dataset.result) === index);
        }
        const match = matches[index];
        const side = pages.indexOf(match.page);
        jumpTo(side >= 0 ? getCurrent().page : match.page, zoom ? match : null, Math.max(0, side));
        trackReader();
        track();
    }
    function showResults() {
        results.replaceChildren(...matches.map((match, index) => {
            const li = document.createElement('li');
            const button = document.createElement('button');
            const heading = document.createElement('strong');
            const snippet = document.createElement('span');
            const mark = document.createElement('mark');
            button.type = 'button';
            button.dataset.result = index;
            heading.textContent = String(match.page).padStart(2,'0') + '면';
            mark.textContent = match.hit;
            snippet.append(match.before, mark, match.after + '…');
            button.append(heading, snippet);
            button.onclick = () => select(index, true);
            li.append(button);
            return li;
        }));
    }
    async function search() {
        const query = fold(ui('search').value.trim());
        const currentJob = ++job;
        matches = [];
        selected = -1;
        results.replaceChildren();
        output.textContent = '';
        schedule();
        if (!query) return;
        if (!pdf) { output.textContent = '이 호에는 검색할 원본 PDF가 없습니다.'; return; }
        output.textContent = '지면을 검색하는 중입니다.';
        try {
            if (!cache.has(pdf)) {
                const request = issue === 1 ? fetch('/epaper/files/1/search-index.json').then(response => {
                    if (!response.ok) throw new Error('색인 없음');
                    return response.json();
                }).catch(() => indexPdf(pdf)) : indexPdf(pdf);
                cache.set(pdf, request);
                void request.catch(() => { for (const [key, value] of cache) if (value === request) cache.delete(key); });
            }
            const index = await cache.get(pdf);
            if (job !== currentJob) return;
            matches = findMatches(index, query);
            output.textContent = matches.length ? '총 ' + matches.length.toLocaleString('ko-KR') + '건' : '검색 결과가 없습니다.';
            showResults();
            if (matches.length) {
                const firstVisible = matches.findIndex(match => pages.includes(match.page));
                select(Math.max(0, firstVisible));
            }
        } catch {
            if (job === currentJob) output.textContent = 'PDF 텍스트를 검색하지 못했습니다.';
        }
    }
    let debounce;
    ui('search-form').onsubmit = event => { event.preventDefault(); clearTimeout(debounce); void search(); };
    ui('search').oninput = () => { clearTimeout(debounce); debounce = setTimeout(search, 240); };
    return {
        setIssue(number, source) {
            if (issue === number) return;
            issue = number;
            pdf = source;
            job++;
            matches = [];
            selected = -1;
            results.replaceChildren();
            output.textContent = '';
            if (visible && ui('search').value.trim()) void search();
        },
        setPages(left, right) { pages = [left, right]; track(); },
        setVisible(value) { visible = value; track(); },
        track,
    };
}
