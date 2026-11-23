import { supabase } from './supabase.js';

const photos = [...document.querySelectorAll('.inside-editor img[data-opinion-portrait]')];
if (photos.length) {
    const { data } = await supabase.storage.from('evere-avatars')
        .createSignedUrls(photos.map(photo => photo.dataset.opinionPortrait), 3600);
    const urls = new Map((data || []).map(({ path, signedUrl }) => [path, signedUrl]));
    for (const photo of photos) {
        const url = urls.get(photo.dataset.opinionPortrait);
        if (!url) continue;
        const placeholder = photo.src;
        photo.addEventListener('error', () => {
            photo.classList.add('evere-media-placeholder');
            photo.src = placeholder;
        }, { once: true });
        photo.classList.remove('evere-media-placeholder');
        photo.src = url;
    }
}
