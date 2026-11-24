const entries = [...document.querySelectorAll('#recentList > li')];
const dates = [...new Set(entries.map((entry) => entry.dataset.articleDate))].sort();
const picker = document.querySelector('#opinion-date-picker');
const dateLabel = document.querySelector('#selected-date');
const calendar = document.querySelector('.btn-calendar');
const all = document.querySelector('.btn-date-all');
const pagination = document.querySelector('.contents .page');
const empty = document.querySelector('#no_result');
const controls = [...document.querySelectorAll('.dateMove')];
const defaultLabel = dateLabel.textContent;
let selected = '';
const paging = pagination?.querySelector('#paging');
const pageSize = 10;

function adjacentDate(mode) {
    if (!selected) return mode === 'prev' ? dates.at(-1) : undefined;
    return mode === 'prev'
        ? dates.findLast((date) => date < selected)
        : dates.find((date) => date > selected);
}

function renderList(date = '', requested = 1) {
    selected = date;
    if (picker) picker.value = date;
    dateLabel.textContent = date ? date.replaceAll('-', '.') : defaultLabel;
    dateLabel.classList.toggle('disabled', !date);

    const matching = entries.filter(entry => !date || entry.dataset.articleDate === date);
    const count = Math.ceil(matching.length / pageSize);
    const page = Math.max(1, Math.min(requested, count));
    const shown = new Set(paging ? matching.slice((page - 1) * pageSize, page * pageSize) : matching);
    for (const entry of entries) entry.hidden = !shown.has(entry);
    if (paging) renderPaging(count, page);
    else if (pagination) pagination.hidden = Boolean(date) || !pagination.childElementCount;
    const visible = shown.size;
    calendar.disabled = dates.length === 0;
    all.disabled = dates.length === 0;
    empty.style.display = visible ? 'none' : 'block';

    for (const control of controls) {
        const disabled = !adjacentDate(control.dataset.mode);
        control.classList.toggle('disabled', disabled);
        control.setAttribute('aria-disabled', String(disabled));
    }
    if (paging) pagination.closest('.contents').dispatchEvent(new Event('evere:list-page'));
}

function renderPaging(count, page) {
    pagination.hidden = !count;
    paging.replaceChildren();
    if (!count) return;
    const first = Math.floor((page - 1) / 5) * 5 + 1;
    const last = Math.min(first + 4, count);
    const add = (target, label, direction) => {
        const row = document.createElement('li');
        const link = document.createElement('a');
        link.href = '#recent';
        link.textContent = label;
        if (direction) {
            link.className = 'btn btn-' + direction;
            const text = document.createElement('span');
            text.className = 'txt';
            text.textContent = label;
            link.replaceChildren(text);
        }
        if (target < 1 || target > count) {
            link.classList.add('disabled');
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
        } else if (target === page) {
            row.className = 'active';
            link.setAttribute('aria-current', 'page');
        } else {
            link.addEventListener('click', event => {
                event.preventDefault();
                renderList(selected, target);
                document.querySelector('#recent').scrollIntoView({ block: 'start' });
                paging.querySelector('[aria-current="page"]')?.focus({ preventScroll: true });
            });
        }
        row.append(link);
        paging.append(row);
    };
    add(first - 1, '이전 페이지로 이동', 'prev');
    for (let n = first; n <= last; n++) add(n, String(n));
    add(last + 1, '다음 페이지로 이동', 'next');
}

for (const control of controls) {
    control.addEventListener('click', (event) => {
        event.preventDefault();
        const date = adjacentDate(control.dataset.mode);
        if (date) renderList(date);
    });
}

calendar.addEventListener('click', () => {
    if (!picker) return;
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else picker.focus();
});
picker?.addEventListener('change', () => renderList(picker.value));
all.addEventListener('click', () => renderList());
empty.querySelector('.btn-reset')?.addEventListener('click', () => renderList());
renderList();
