import { supabase } from './supabase.js';
import { photoBucket, readPhotoCaption } from './article-content.js?v=photo-options-1';

const types = new Map([['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]);
const maxPhotoSize = 5 * 1024 * 1024;
const validFile = file => file && [...types.values()].includes(file.type) && file.size > 0 && file.size <= maxPhotoSize;
const storedPath = /^[a-f\d-]{36}\/[a-f\d-]{36}\.(?:jpg|png|webp)$/i;

async function findPhotos(query, active) {
    const matches = new Map();
    const batch = 40;
    const token = query.toLocaleLowerCase('ko-KR');
    // Escape text as stored HTML before searching the shortlist. Verify the actual caption below.
    const carrier = document.createElement('span');
    carrier.textContent = query;
    const escaped = carrier.innerHTML.replace(/[\\%_]/g, char => '\\' + char);
    for (let offset = 0; active(); offset += batch) {
        const { data, error } = await supabase.from('evere_articles').select('id,body_html,photo_paths')
            .ilike('body_html', '%' + escaped + '%')
            .order('created_at', { ascending: false }).order('id').range(offset, offset + batch - 1);
        if (error) throw error;
        for (const entry of data || []) {
            const template = document.createElement('template');
            template.innerHTML = entry.body_html || '';
            const paths = new Set(entry.photo_paths || []);
            for (const figure of template.content.querySelectorAll('figure[data-photo]')) {
                const path = figure.dataset.photo;
                if (!storedPath.test(path) || !paths.has(path) || matches.has(path)) continue;
                const caption = readPhotoCaption(figure);
                if (![caption.captionTitle, caption.caption].some(value => value.toLocaleLowerCase('ko-KR').includes(token))) continue;
                matches.set(path, { path, ...caption });
                if (matches.size === 20) return [...matches.values()];
            }
        }
        if (!data || data.length < batch) break;
    }
    return [...matches.values()];
}

export function openPhotoDialog({ file, photo } = {}) {
    const dialog = document.querySelector('#photo-options-template').content.firstElementChild.cloneNode(true);
    const form = dialog.querySelector('form');
    const fields = form.elements;
    const source = dialog.querySelector('[data-photo-source]');
    const preview = dialog.querySelector('[data-photo-preview]');
    const status = dialog.querySelector('[data-photo-status]');
    const results = dialog.querySelector('[data-photo-results]');
    const apply = dialog.querySelector('[type="submit"]');
    let selectedPhoto, selectedFile, previewUrl, searchVersion = 0, output;
    let pending = false;
    if (photo) {
        source.hidden = true;
        preview.hidden = !photo.url;
        if (photo.url) preview.src = photo.url;
        fields.size.value = photo.size || 'original';
        fields.position.value = photo.position || 'center';
        fields.captionAlign.value = photo.captionAlign || 'left';
        fields.captionTitle.value = photo.captionTitle || '';
        fields.caption.value = photo.caption || '';
        dialog.querySelector('[data-photo-insert-mode]').hidden = true;
    }

    function previewFile(next) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        selectedFile = null;
        selectedPhoto = null;
        preview.hidden = true;
        for (const button of results.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
        if (!validFile(next)) {
            status.textContent = 'JPG, PNG, WebP 형식의 5MB 이하 사진을 선택해 주세요.';
            return;
        }
        selectedFile = next;
        previewUrl = URL.createObjectURL(next);
        preview.src = previewUrl;
        preview.hidden = false;
        status.textContent = next.name;
    }

    fields.file.addEventListener('change', () => previewFile(fields.file.files[0]));
    if (file) previewFile(file);

    async function search() {
        const term = fields.photoQuery.value.trim();
        const version = ++searchVersion;
        results.replaceChildren();
        if (!term) {
            status.textContent = '사진 제목이나 설명을 입력해 주세요.';
            return;
        }
        status.textContent = '기존 사진을 검색하는 중입니다.';
        try {
            const rows = await findPhotos(term, () => dialog.open && version === searchVersion);
            if (!dialog.open || version !== searchVersion) return;
            const response = rows.length ? await photoBucket.createSignedUrls(rows.map(row => row.path), 600) : null;
            if (!dialog.open || version !== searchVersion) return;
            const urls = new Map((response?.data || []).map(({ path, signedUrl }) => [path, signedUrl]));
            for (const row of rows) {
                const url = urls.get(row.path);
                if (!url) continue;
                const button = document.createElement('button');
                button.type = 'button';
                button.setAttribute('aria-pressed', 'false');
                const image = document.createElement('img');
                image.src = url;
                image.alt = '';
                image.loading = 'lazy';
                const copy = document.createElement('span');
                copy.textContent = row.captionTitle || row.caption;
                if (row.captionTitle && row.caption) {
                    const description = document.createElement('small');
                    description.textContent = row.caption;
                    copy.append(description);
                }
                button.append(image, copy);
                button.addEventListener('click', () => {
                    if (pending) return;
                    selectedPhoto = row;
                    selectedFile = null;
                    fields.file.value = '';
                    fields.captionTitle.value = row.captionTitle;
                    fields.caption.value = row.caption;
                    preview.src = url;
                    preview.hidden = false;
                    for (const option of results.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === button));
                    status.textContent = '선택한 사진의 옵션을 확인해 주세요.';
                });
                results.append(button);
            }
            status.textContent = results.childElementCount ? '삽입할 사진을 선택해 주세요.' : '검색 결과가 없습니다.';
        } catch {
            if (dialog.open && version === searchVersion) status.textContent = '사진을 불러오지 못했습니다. 다시 시도해 주세요.';
        }
    }
    dialog.querySelector('[data-photo-search]').addEventListener('click', () => void search());
    fields.photoQuery.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            void search();
        }
    });
    dialog.querySelector('[data-photo-cancel]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (pending) return;
        if (!photo && !selectedFile && !selectedPhoto) {
            status.textContent = '사진 파일이나 검색 결과를 먼저 선택해 주세요.';
            return;
        }
        const options = { size: fields.size.value, position: fields.position.value,
            captionAlign: fields.captionAlign.value, captionTitle: fields.captionTitle.value,
            caption: fields.caption.value, insert: fields.insert.value === 'auto' };
        try {
            pending = true;
            apply.disabled = true;
            let next = selectedFile;
            if (selectedPhoto) {
                status.textContent = '선택한 사진을 불러오는 중입니다.';
                const path = selectedPhoto.path;
                const extension = path.split('.').at(-1).toLowerCase();
                const { data, error } = await photoBucket.download(path);
                if (error || !data || !types.has(extension)) throw error || new Error('Photo unavailable');
                next = new File([data], (selectedPhoto.captionTitle || '기존 사진') + '.' + extension,
                    { type: types.get(extension) });
            }
            if (!dialog.open) return;
            if (!photo && !validFile(next)) throw new Error('Invalid photo');
            output = { ...options, file: next };
            dialog.close();
        } catch {
            if (dialog.open) status.textContent = '사진을 불러오지 못했습니다. 파일 크기나 접근 권한을 확인해 주세요.';
        } finally {
            pending = false;
            apply.disabled = false;
        }
    });
    const result = new Promise(resolve => {
        dialog.addEventListener('close', () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            dialog.remove();
            resolve(output);
        }, { once: true });
    });
    document.body.append(dialog);
    dialog.showModal();
    return { result, close: () => { if (dialog.open) dialog.close(); } };
}
