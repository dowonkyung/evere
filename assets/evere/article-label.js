const labels = new Map([
    ['exclusive', ['단독', 'tag-blue']],
    ['breaking', ['속보', 'tag-red']],
]);

export function setArticleTitle(target, title, label) {
    const tag = labels.get(label);
    target.textContent = title;
    if (!tag) return;
    const badge = document.createElement('span');
    badge.className = 'tag ' + tag[1];
    badge.textContent = tag[0];
    const prefix = '[' + tag[0] + ']';
    if (title.startsWith(prefix)) target.textContent = title.slice(prefix.length).trimStart();
    target.prepend(badge);
}

export function articlePageTitle(title, label) {
    const tag = labels.get(label);
    if (!tag) return title;
    const prefix = '[' + tag[0] + ']';
    return title.startsWith(prefix) ? title : prefix + ' ' + title;
}
