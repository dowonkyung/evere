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

function adjacentDate(mode) {
    if (!selected) return mode === 'prev' ? dates.at(-1) : undefined;
    return mode === 'prev'
        ? dates.findLast((date) => date < selected)
        : dates.find((date) => date > selected);
}

function renderList(date = '') {
    selected = date;
    picker.value = date;
    dateLabel.textContent = date ? date.replaceAll('-', '.') : defaultLabel;
    dateLabel.classList.toggle('disabled', !date);

    let visible = 0;
    for (const entry of entries) {
        entry.hidden = Boolean(date) && entry.dataset.articleDate !== date;
        if (!entry.hidden) visible++;
    }
    if (pagination) pagination.hidden = Boolean(date) || !pagination.childElementCount;
    calendar.disabled = dates.length === 0;
    all.disabled = dates.length === 0;
    empty.style.display = visible ? 'none' : 'block';

    for (const control of controls) {
        const disabled = !adjacentDate(control.dataset.mode);
        control.classList.toggle('disabled', disabled);
        control.setAttribute('aria-disabled', String(disabled));
    }
}

for (const control of controls) {
    control.addEventListener('click', (event) => {
        event.preventDefault();
        const date = adjacentDate(control.dataset.mode);
        if (date) renderList(date);
    });
}

calendar.addEventListener('click', () => {
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else picker.focus();
});
picker.addEventListener('change', () => renderList(picker.value));
all.addEventListener('click', () => renderList());
empty.querySelector('.btn-reset')?.addEventListener('click', () => renderList());
renderList();
