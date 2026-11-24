import { supabase } from './supabase.js';

const groups = [
    { name: '이벤트 기사', slots: [9, 10, 11, 12], targets: ['[data-home-events]'] },
    { name: '대표 헤드라인', slots: [1], targets: ['[data-home-primary]'] },
    { name: '보조 헤드라인 1·2', slots: [2, 3], targets: ['[data-home-secondary]'] },
    { name: '하단 대표 기사와 아래 기사', slots: [4, 8], targets: ['[data-home-slot="4"]', '[data-home-slot="8"]'] },
    { name: '하단 오른쪽 기사 3개', slots: [5, 6, 7], targets: ['[data-home-sub-list] .sub-block'] },
];
const labels = ['대표 헤드라인', '보조 헤드라인 1', '보조 헤드라인 2', '하단 대표 기사',
    '하단 오른쪽 기사 1', '하단 오른쪽 기사 2', '하단 오른쪽 기사 3', '하단 대표 기사 바로 아래', '이벤트 기사 1', '이벤트 기사 2', '이벤트 기사 3', '이벤트 기사 4'];
const batchSize = 20;

export function configureHomeVisualEditor(isHomeSelected, openIssues) {
    const ui = id => document.getElementById(id);
    const editor = ui('home-visual-editor');
    const frame = ui('home-preview');
    const dialog = ui('home-placement-dialog');
    const slotList = ui('home-placement-slots');
    const searchForm = ui('home-placement-search');
    const results = ui('home-placement-results');
    const more = ui('home-placement-more');
    const status = ui('home-placement-status');
    const save = ui('home-placement-save');
    const saveStatus = ui('home-placement-save-status');
    const choices = new Map();
    let activeGroup;
    let activeSlot;
    let searchRequest = 0;
    let nextOffset = 0;
    let loaded = false;
    let saving = false;
    let stopObservingPreview = () => {};

    function button(label, handler, owner = document) {
        const el = owner.createElement('button');
        el.type = 'button';
        el.textContent = label;
        el.onclick = handler;
        return el;
    }

    async function getPlacements() {
        const { data, error } = await supabase.from('evere_page_slots')
            .select('slot,evere_articles(id,title,status)').eq('page', 'home').eq('category', '');
        if (error) throw error;
        return new Map(data.filter(row => row.evere_articles?.status === 'published')
            .map(row => [row.slot, row.evere_articles]));
    }

    function renderSlots() {
        slotList.replaceChildren(...activeGroup.slots.map(slot => {
            const row = document.createElement('div');
            row.className = 'home-placement-row';
            const choice = choices.get(slot);
            const select = button(labels[slot - 1] + ' · ' + (choice?.title || '배치하지 않음'), () => {
                if (activeSlot === slot) return;
                activeSlot = slot;
                renderSlots();
                slotList.querySelector('[aria-pressed="true"]').focus();
            });
            select.setAttribute('aria-pressed', String(slot === activeSlot));
            row.append(select);
            if (choice) row.append(button('비우기', () => {
                choices.delete(slot);
                renderSlots();
                rowFocus();
            }));
            return row;
        }));
    }

    function rowFocus() {
        slotList.querySelector('[aria-pressed="true"]')?.focus();
    }

    async function searchArticles(offset = 0) {
        const request = ++searchRequest;
        more.hidden = true;
        if (!offset) results.replaceChildren();
        status.textContent = '기사를 불러오는 중입니다.';
        try {
            const keyword = searchForm.elements.keyword.value.trim().replace(/[\\%_]/g, character => '\\' + character);
            let query = supabase.from('evere_articles').select('id,title')
                .eq('status', 'published').not('article_number', 'is', null);
            if (keyword) query = query.ilike('title', '%' + keyword + '%');
            const { data, error } = await query.order('published_at', { ascending: false, nullsFirst: false })
                .order('id').range(offset, offset + batchSize);
            if (request !== searchRequest || !dialog.open) return;
            if (error) throw error;
            for (const article of data.slice(0, batchSize)) {
                const row = document.createElement('li');
                const title = document.createElement('span');
                title.textContent = article.title;
                const select = button('선택', () => {
                    if (!loaded || saving) return;
                    choices.set(activeSlot, article);
                    renderSlots();
                    saveStatus.textContent = '';
                });
                select.setAttribute('aria-label', article.title + ' 선택');
                row.append(title, select);
                results.append(row);
            }
            nextOffset = offset + batchSize;
            more.hidden = data.length <= batchSize;
            status.textContent = results.childElementCount ? '' : '검색 결과가 없습니다.';
        } catch {
            if (request === searchRequest && dialog.open) status.textContent = '기사를 불러오지 못했습니다.';
        }
    }

    async function openGroup(group) {
        if (!isHomeSelected() || dialog.open) return;
        activeGroup = group;
        activeSlot = group.slots[0];
        loaded = false;
        choices.clear();
        results.replaceChildren();
        slotList.replaceChildren();
        more.hidden = true;
        save.disabled = true;
        searchForm.reset();
        status.textContent = '';
        saveStatus.textContent = '현재 배치를 불러오는 중입니다.';
        ui('home-placement-title').textContent = group.name + ' 편집';
        dialog.showModal();
        const request = ++searchRequest;
        try {
            const placements = await getPlacements();
            if (request !== searchRequest || !dialog.open) return;
            for (const slot of group.slots) {
                if (placements.has(slot)) choices.set(slot, placements.get(slot));
            }
            renderSlots();
            loaded = true;
            save.disabled = false;
            saveStatus.textContent = '';
            void searchArticles();
        } catch {
            if (request === searchRequest && dialog.open) saveStatus.textContent = '현재 배치를 불러오지 못했습니다.';
        }
    }

    searchForm.addEventListener('submit', event => {
        event.preventDefault();
        if (loaded) void searchArticles();
    });
    more.addEventListener('click', () => void searchArticles(nextOffset));
    dialog.addEventListener('close', () => { searchRequest++; });
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.querySelector('form[method="dialog"]').addEventListener('submit', event => {
        if (saving) event.preventDefault();
    });
    save.addEventListener('click', async () => {
        if (!loaded || saving || !isHomeSelected()) return;
        saving = true;
        save.disabled = true;
        saveStatus.textContent = '배치를 저장하는 중입니다.';
        try {
            const latest = await getPlacements();
            const articles = labels.map((_, i) => (activeGroup.slots.includes(i + 1)
                ? choices.get(i + 1) : latest.get(i + 1))?.id || null);
            const chosen = articles.filter(Boolean);
            if (new Set(chosen).size !== chosen.length) {
                saveStatus.textContent = '같은 기사는 한 위치에만 배치할 수 있습니다.';
                return;
            }
            const { error } = await supabase.rpc('evere_save_layout', {
                target_page: 'home', target_category: '', articles,
            });
            if (error) throw error;
            dialog.close();
            frame.src = '/?preview=home-layout&updated=' + Date.now();
        } catch {
            saveStatus.textContent = '배치를 저장하지 못했습니다. 다시 시도해 주세요.';
        } finally {
            saving = false;
            save.disabled = false;
        }
    });

    frame.addEventListener('load', () => {
        stopObservingPreview();
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        const home = doc?.querySelector('[data-home-articles]');
        if (!home || !win) return;
        const style = doc.createElement('style');
        style.textContent = `
            [data-home-list][hidden] { display: flex !important; }
            [data-home-list] .main-block[hidden], [data-home-list] [data-home-sub-list][hidden],
            [data-home-list] [data-home-slot][hidden] { display: block !important; }
            [data-home-list-empty] { display: none !important; }
            [data-home-slot]:empty { min-height: 90px; }
            [data-home-slot="4"]:empty { min-height: 220px; }
            [data-home-slot]:empty::after { content: "배치된 기사 없음"; display: block; padding: 18px 10px; color: #606666; }
            [data-home-list] { min-height: 350px; }
            [data-home-events], [data-home-event-links-region], [data-home-service-cards] { min-height: 42px; }
            .home-preview-region { position: absolute; box-sizing: border-box; border: 2px dashed #007a79;
                border-radius: 6px; pointer-events: none; z-index: 151; }
            .home-preview-region button {
                position: absolute; top: 6px; left: 6px; pointer-events: auto;
                display: grid; place-items: center; box-sizing: border-box;
                width: 30px; height: 30px; padding: 4px; border: 1px solid #aaa;
                border-radius: 50%; background: #fff; color: #444; cursor: pointer;
            }
            .home-preview-region button svg { display: block; width: 20px; height: 20px; }
        `;
        doc.head.append(style);
        const regions = [{ name: '메인 이슈 링크', targets: ['.evere-home-issues'], open: () => openIssues() },
            { name: '이벤트 링크', targets: ['[data-home-event-links-region]'], open: () => openIssues('event_links') },
            { name: '하단 바로가기', targets: ['[data-home-service-cards]'], open: () => openIssues('service_cards') },
            ...groups.map(group => ({ ...group, open: () => openGroup(group) }))];
        const overlays = regions.map(group => {
            const targets = group.targets.map(selector => doc.querySelector(selector)).filter(Boolean);
            const overlay = doc.createElement('div');
            overlay.className = 'home-preview-region';
            const edit = button('', () => void group.open(), doc);
            edit.setAttribute('aria-label', group.name + ' 편집');
            edit.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" stroke-width="1.5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.0207 5.82839L15.8491 2.99996L20.7988 7.94971L17.9704 10.7781M13.0207 5.82839L3.41405 15.435C3.22652 15.6225 3.12116 15.8769 3.12116 16.1421V20.6776H7.65669C7.92191 20.6776 8.17626 20.5723 8.3638 20.3847L17.9704 10.7781M13.0207 5.82839L17.9704 10.7781" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            overlay.append(edit);
            doc.body.append(overlay);
            return { targets, overlay };
        });
        doc.addEventListener('click', event => {
            if (event.target.closest('a[href]')) event.preventDefault();
        }, true);
        doc.addEventListener('submit', event => event.preventDefault(), true);
        let updateFrame;
        function scheduleOverlay() {
            win.cancelAnimationFrame(updateFrame);
            updateFrame = win.requestAnimationFrame(() => {
                for (const { targets, overlay } of overlays) {
                    const rects = targets.map(target => target.getBoundingClientRect());
                    if (!rects.length) continue;
                    const left = Math.min(...rects.map(rect => rect.left));
                    const top = Math.min(...rects.map(rect => rect.top));
                    const right = Math.max(...rects.map(rect => rect.right));
                    const bottom = Math.max(...rects.map(rect => rect.bottom));
                    Object.assign(overlay.style, {
                        left: left + win.scrollX + 'px', top: top + win.scrollY + 'px',
                        width: right - left + 'px', height: bottom - top + 'px',
                    });
                }
            });
        }
        const observer = new win.ResizeObserver(scheduleOverlay);
        observer.observe(doc.querySelector('main'));
        for (const { targets } of overlays) targets.forEach(target => observer.observe(target));
        win.addEventListener('resize', scheduleOverlay);
        scheduleOverlay();
        stopObservingPreview = () => {
            observer.disconnect();
            win.removeEventListener('resize', scheduleOverlay);
            win.cancelAnimationFrame(updateFrame);
        };
    });

    return visible => {
        editor.hidden = !visible;
        if (visible && !frame.hasAttribute('src')) frame.src = '/?preview=home-layout';
    };
}
