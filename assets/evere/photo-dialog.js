import { photoBucket } from './article-content.js?v=photo-options-1';

const types = new Map([['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]);
const maxPhotoSize = 5 * 1024 * 1024;
const validFile = file => file && [...types.values()].includes(file.type) && file.size > 0 && file.size <= maxPhotoSize;

export function openPhotoDialog({ file, photo, libraryPhoto } = {}) {
    const dialog = document.querySelector('#photo-options-template').content.firstElementChild.cloneNode(true);
    const form = dialog.querySelector('form');
    const fields = form.elements;
    const source = dialog.querySelector('[data-photo-source]');
    const preview = dialog.querySelector('[data-photo-preview]');
    const status = dialog.querySelector('[data-photo-status]');
    const apply = dialog.querySelector('[type="submit"]');
    let selectedFile, previewUrl, output;
    let pending = false;
    if (photo) {
        source.hidden = true;
        preview.hidden = !photo.url;
        if (photo.url) preview.src = photo.url;
        fields.size.value = photo.size || 'original';
        fields.position.value = photo.position || 'center';
        fields.captionTitle.value = photo.captionTitle || '';
        fields.caption.value = photo.caption || '';
    } else if (libraryPhoto) {
        source.hidden = true;
        preview.src = libraryPhoto.url;
        preview.hidden = false;
        fields.captionTitle.value = libraryPhoto.captionTitle;
        fields.caption.value = libraryPhoto.caption;
    }

    function previewFile(next) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        selectedFile = null;
        preview.hidden = true;
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

   dialog.querySelector('[data-photo-cancel]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (pending) return;
        if (!photo && !selectedFile && !libraryPhoto) {
            status.textContent = '사진 파일이나 검색 결과를 먼저 선택해 주세요.';
            return;
        }
        const options = { size: fields.size.value, position: fields.position.value,
            captionAlign: photo?.captionAlign || 'left', captionTitle: fields.captionTitle.value,
            caption: fields.caption.value };
        try {
            pending = true;
            apply.disabled = true;
            let next = selectedFile;
            if (libraryPhoto) {
                status.textContent = '선택한 사진을 불러오는 중입니다.';
                const path = libraryPhoto.path;
                const extension = path.split('.').at(-1).toLowerCase();
                const { data, error } = await photoBucket.download(path);
                if (error || !data || !types.has(extension)) throw error || new Error('Photo unavailable');
                next = new File([data], (libraryPhoto.captionTitle || '기존 사진') + '.' + extension,
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
