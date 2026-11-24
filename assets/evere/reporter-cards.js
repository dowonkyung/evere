import { supabase } from './supabase.js';
import { collectionButton } from './reader-collections.js';

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function configureArrows(section, list) {
    const previous = section.querySelector('.profile-previous');
    const next = section.querySelector('.profile-next');
    const update = () => {
        if (list.children.length < 2) return;
        const remaining = list.scrollWidth - list.clientWidth - list.scrollLeft;
        previous.hidden = list.scrollLeft < 2;
        next.hidden = remaining < 2;
    };
    const move = direction => {
        const first = list.firstElementChild;
        const second = first?.nextElementSibling;
        if (!second) return;
        const step = second.offsetLeft - first.offsetLeft;
        const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
        list.scrollBy({ left: direction * step, behavior });
    };
    previous.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    list.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(list);
    update();
}

export async function showReporterCards(data) {
    const section = document.querySelector('#reporter-profiles');
    const list = section.querySelector('.profile_card_list');
    if (!data?.length) return;
    const photos = new Map();
    for (const reporter of data) {
        const card = node('li', 'profile_wrap');
        const href = reporter.reporter_number ? '/reporter/' + reporter.reporter_number : '';
        const avatar = node(href ? 'a' : 'span', 'reporter-avatar', Array.from(reporter.display_name)[0]);
        if (href) {
            avatar.href = href;
            avatar.setAttribute('aria-label', reporter.display_name + ' 기자 페이지');
        } else {
            avatar.setAttribute('aria-hidden', 'true');
        }
        if (reporter.avatar_path) photos.set(reporter.avatar_path, avatar);
        const content = node('div', 'reporter-card-content');
        const name = node('h2', 'reporter-card-name', reporter.display_name);
        const position = node('p', 'reporter-card-position', reporter.position_title?.trim() || '기자');
        const heading = node('div', 'reporter-card-heading');
        if (href) {
            const profile = node('a', '', reporter.display_name);
            profile.href = href;
            name.replaceChildren(profile);
        }
        heading.append(name, position);
        const top = node('div', 'reporter-card-top');
        top.append(heading);
        content.append(top);
        if (reporter.public_email) {
            const email = node('a', 'reporter-card-email', reporter.public_email);
            email.href = 'mailto:' + encodeURIComponent(reporter.public_email).replace('%40', '@');
            content.append(email);
        }
        if (reporter.bio) content.append(node('p', 'reporter-card-bio', reporter.bio));
        const actions = node('div', 'reporter-card-actions');
        const follow = node('button', 'reporter-card-follow');
        follow.type = 'button';
        follow.hidden = true;
        actions.append(follow);
        top.append(actions);
        card.append(avatar, content);
        list.append(card);
        void collectionButton(follow, 'reporters', reporter.reporter_id, ['구독', '구독 취소'], content).catch(() => {});
    }
    section.hidden = false;
    if (data.length > 1) configureArrows(section, list);
    else list.removeAttribute('tabindex');
    if (!photos.size) return;
    const response = await supabase.storage.from('evere-avatars').createSignedUrls([...photos.keys()], 3600);
    for (const { path, signedUrl } of response.data || []) {
        const avatar = photos.get(path);
        if (!avatar || !signedUrl) continue;
        const image = node('img');
        image.alt = '';
        image.width = 64;
        image.height = 64;
        image.loading = 'lazy';
        image.addEventListener('load', () => avatar.replaceChildren(image), { once: true });
        image.src = signedUrl;
        avatar.append(image);
    }
}
