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
    let selectedFile, previewUrl, output;
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
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!photo && !selectedFile && !libraryPhoto) {
            status.textContent = '사진 파일이나 검색 결과를 먼저 선택해 주세요.';
            return;
        }
        const options = { size: fields.size.value, position: fields.position.value,
            captionAlign: photo?.captionAlign || 'left', captionTitle: fields.captionTitle.value,
            caption: fields.caption.value };
        output = libraryPhoto
            ? { ...options, path: libraryPhoto.path, url: libraryPhoto.url }
            : { ...options, file: selectedFile };
        dialog.close();
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
