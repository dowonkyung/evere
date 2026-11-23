import { formattedBody, photoBucket, photoFigure, photoImage, readPhotoCaption, renderBody, setPhotoCaption } from './article-content.js?v=caption-1';
import { seriesFor } from './series.js';

const photoTypes = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const editors = new Set(['owner', 'director', 'department_head']);

export function articleComposer(form, article = null) {
    form.replaceChildren(document.getElementById('compose-fields').content.cloneNode(true));
    const find = (name) => form.querySelector(name);
    const { title, subtitle, sector, category, series, writer, guest, omitByline, photos: fileInput } = form.elements;
    const editor = find('.compose-editor');
    const toolbar = find('.compose-toolbar');
    const photoList = find('[data-thumbs]');
    const feedback = find('[data-compose-feedback]');
    let member;
    let people = [];
    let byline = [...(article?.byline || [])];
    let guests = [...(article?.guest_byline || [])];
    let photos = (article?.photo_paths || []).map((path) => ({ path, key: path, position: 'center', caption: '' }));
    let selection;
    let saving = false;
    let seriesRequest = 0;
    let selectedSeries = article?.series_id || '';
    let allowsOmission = false;

    const label = form.elements.articleLabel;
    label.value = article?.article_label || '';
    title.value = article?.title || '';
    subtitle.value = article?.subtitle || '';
    renderBody(editor, article || {});
    updateEditorCount();

    function notify(message = '') {
        feedback.textContent = message;
    }

    function updateEditorCount() {
        const copy = editor.innerText.trim();
        find('[data-editor-count]').textContent =
            Array.from(copy).length.toLocaleString('ko-KR') + '자 · ' +
            (copy ? copy.split(/\s+/u).length : 0).toLocaleString('ko-KR') + '단어';
    }

    async function refreshSeries(chosen = selectedSeries) {
        const request = ++seriesRequest;
        const currentSector = sector.value;
        series.disabled = true;
        try {
            const rows = await seriesFor(currentSector);
            if (request !== seriesRequest) return;
            series.replaceChildren(new Option('선택 안 함', ''), ...rows.map(({ id, title }) =>
                new Option(title, id, false, id === chosen)));
            selectedSeries = series.value;
        } catch {
            if (request === seriesRequest) notify('기획·연재 분류를 불러오지 못했습니다. 다시 시도해 주세요.');
        } finally {
            if (request === seriesRequest) series.disabled = false;
        }
    }
    series.addEventListener('change', () => { selectedSeries = series.value; });

    function displayName(id) {
        return people.find((person) => person.id === id)?.display_name || '이브레 기자';
    }

    function removable(label, remove) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '삭제';
        button.setAttribute('aria-label', label + ' 삭제');
        button.addEventListener('click', remove);
        return button;
    }

    function canAddGuest() {
        return editors.has(member?.role) &&
            (member.role !== 'department_head' || member.sectors.includes(sector.value));
    }

    function refreshWriters() {
        if (!member) return;
        const selected = writer.value;
        const available = people.filter(({ id }) => !byline.includes(id));
        writer.replaceChildren(new Option('기자 선택', ''), ...available.map(({ id, display_name }) =>
            new Option(display_name, id, false, id === selected)));
        const ownOnly = !article && member.role === 'citizen';
        const omitted = omitByline.checked;
        find('[data-byline-list]').hidden = omitted;
        find('[data-member-picker]').hidden = ownOnly || omitted;
        find('[data-guest-picker]').hidden = omitted || !canAddGuest();
        find('[data-byline-help]').textContent = omitted ? '기사에 기자명이 표시되지 않습니다.'
            : ownOnly ? '시민기자는 본인 이름으로 송고합니다.'
            : member.role === 'reporter' ? '공동 기자를 추가할 수 있습니다. 본인 이름을 포함해 주세요.'
                : canAddGuest() ? '이브레 기자를 선택하거나 외부 기고자 이름을 직접 입력하세요.' : '이브레 기자를 선택하세요.';
        const chips = document.createDocumentFragment();
        function append(name, remove, locked = false) {
            const li = document.createElement('li');
            li.append(name);
            if (!locked) li.append(removable(name, () => { remove(); refreshWriters(); }));
            chips.append(li);
        }
        for (const id of byline) {
            append(displayName(id), () => { byline = byline.filter((value) => value !== id); },
                !article && id === member.id && ['citizen', 'reporter'].includes(member.role));
        }
        for (const name of guests) {
            append(name + ' · 외부 기고', () => { guests = guests.filter((value) => value !== name); });
        }
        find('[data-byline-list]').replaceChildren(chips);
    }

    function addWriter(value, list) {
        if (!value || list.includes(value)) return false;
        if (byline.length + guests.length >= 12) {
            notify('기자와 기고자는 최대 12명까지 추가할 수 있습니다.');
            return false;
        }
        list.push(value);
        notify();
        refreshWriters();
        return true;
    }

    find('[data-add-member]').addEventListener('click', () => addWriter(writer.value, byline));
    function addGuest() {
        if (canAddGuest() && addWriter(guest.value.trim(), guests)) guest.value = '';
    }
    find('[data-add-guest]').addEventListener('click', addGuest);
    guest.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); addGuest(); }
    });
    function refreshOmission(defaultOmit = true) {
        const eligible = (sector.value === 'opinion' && category.value === 'editorial') ||
            (sector.value === 'health' && category.value === 'obituaries');
        if (!eligible || !allowsOmission) omitByline.checked = eligible && defaultOmit;
        allowsOmission = eligible;
        find('[data-omit-byline]').hidden = !eligible;
        refreshWriters();
    }

    omitByline.addEventListener('change', () => {
        if (!omitByline.checked && !byline.length && !guests.length && member) byline = [member.id];
        refreshWriters();
    });
    category.addEventListener('change', () => refreshOmission());
    sector.addEventListener('change', () => {
        queueMicrotask(() => refreshOmission());
        selectedSeries = '';
        series.replaceChildren(new Option('선택 안 함', ''));
        void refreshSeries('');
    });

    function rememberSelection() {
        const current = window.getSelection();
        if (current.rangeCount && editor.contains(current.anchorNode) && editor.contains(current.focusNode)) {
            selection = current.getRangeAt(0).cloneRange();
        }
    }
    for (const event of ['keyup', 'pointerup', 'input', 'blur']) editor.addEventListener(event, rememberSelection);
    function applyFormat(command, value) {
        editor.focus();
        if (selection && editor.contains(selection.startContainer) && editor.contains(selection.endContainer)) {
            const current = window.getSelection();
            current.removeAllRanges();
            current.addRange(selection);
        }
        document.execCommand(command, false, value);
        rememberSelection();
        updateEditorCount();
    }
    toolbar.addEventListener('mousedown', (event) => {
        if (event.target.closest('button')) event.preventDefault();
    });
    toolbar.addEventListener('click', (event) => {
        if (event.target.closest('[data-insert-photo]')) {
            fileInput.click();
            return;
        }
        const control = event.target.closest('[data-command]');
        if (control) applyFormat(control.dataset.command);
    });
    toolbar.addEventListener('change', (event) => {
        const control = event.target;
        if (control.dataset.format && control.value) applyFormat(control.dataset.format, control.value);
    });
    function insertPlainText(event, transfer) {
        event.preventDefault();
        const plain = transfer?.getData('text/plain');
        if (plain) document.execCommand('insertText', false, plain);
    }
    editor.addEventListener('paste', (event) => {
        const files = event.clipboardData.files;
        if (!files.length) return insertPlainText(event, event.clipboardData);
        event.preventDefault();
        rememberSelection();
        addPhotos(files);
    });
    editor.addEventListener('dragover', (event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
    });
    editor.addEventListener('drop', (event) => {
        if (event.dataTransfer.files.length) {
            event.preventDefault();
            const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
            const target = document.caretRangeFromPoint?.(event.clientX, event.clientY);
            const node = position?.offsetNode || target?.startContainer;
            if (node && editor.contains(node) && !(node.parentElement?.closest('figure[data-photo]'))) {
                selection = document.createRange();
                selection.setStart(node, position?.offset ?? target.startOffset);
                selection.collapse(true);
            }
            addPhotos(event.dataTransfer.files);
        } else insertPlainText(event, event.dataTransfer);
    });
    editor.addEventListener('input', updateEditorCount);

    function marker(photo) {
        return [...editor.querySelectorAll('figure[data-photo]')].find((item) => item.dataset.photo === photo.key);
    }

    function locate(photo, insertAtEnd = false) {
        if (!selection || !editor.contains(selection.startContainer)) {
            if (!insertAtEnd) {
                notify('사진을 배치할 본문 위치에 먼저 커서를 놓아 주세요.');
                editor.focus();
                return;
            }
            selection = document.createRange();
            selection.selectNodeContents(editor);
            selection.collapse(false);
        }
        const range = selection.cloneRange();
        range.collapse(true);
        const container = range.startContainer;
        const inlinePhoto = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)
            ?.closest('figure[data-photo]');
        if (inlinePhoto) range.setStartAfter(inlinePhoto);
        marker(photo)?.remove();
        const figure = photoFigure(photo.key, photo.position, photo);
        figure.contentEditable = 'false';
        if (photo.url) figure.prepend(photoImage(photo.url, photo.captionTitle || photo.caption || undefined));
        let block = range.startContainer;
        while (block !== editor && block.parentNode !== editor) block = block.parentNode;
        if (block === editor || block.nodeType === Node.TEXT_NODE) {
            range.insertNode(figure);
        } else {
            range.setEndAfter(block);
            const trailing = range.extractContents();
            block.after(figure, trailing);
        }
        let after = figure.nextSibling;
        if (!after || after.nodeName === 'FIGURE') {
            after = document.createElement('div');
            after.append(document.createElement('br'));
            figure.after(after);
        }
        range.setStart(after, 0);
        range.collapse(true);
        selection = range;
        editor.focus();
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        if (!insertAtEnd) {
            notify();
            showPhotos();
        }
    }

    function discard(photo) {
        if (photo.file) URL.revokeObjectURL(photo.url);
        marker(photo)?.remove();
        photos = photos.filter((item) => item !== photo);
        showPhotos();
    }

    function showPhotos() {
        const items = photos.map((photo, index) => {
            const li = document.createElement('li');
            li.dataset.photoKey = photo.key;
            const label = photo.file?.name || '첨부 사진 ' + (index + 1);
            if (photo.url) li.append(photoImage(photo.url, label));
            const name = document.createElement('span');
            name.textContent = label;
            li.append(name, removable(label, () => discard(photo)));
            const placement = document.createElement('div');
            placement.className = 'photo-placement';
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = marker(photo) ? '커서 위치로 이동' : '커서 위치에 삽입';
            button.addEventListener('click', () => locate(photo));
            const alignment = document.createElement('select');
            alignment.setAttribute('aria-label', label + ' 배치 정렬');
            alignment.replaceChildren(...[['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]
                .map(([value, text]) => new Option(text, value, false, value === photo.position)));
            alignment.addEventListener('change', () => {
                photo.position = alignment.value;
                const figure = marker(photo);
                if (figure) figure.dataset.position = photo.position;
            });
            const heading = document.createElement('input');
            heading.maxLength = 200;
            heading.placeholder = '사진 제목';
            heading.setAttribute('aria-label', label + ' 제목');
            heading.value = photo.captionTitle || '';
            const caption = document.createElement('textarea');
            caption.maxLength = 500;
            caption.rows = 2;
            caption.placeholder = '사진 설명';
            caption.setAttribute('aria-label', label + ' 설명');
            caption.value = photo.caption;
            const syncCaption = () => {
                photo.captionTitle = heading.value;
                photo.caption = caption.value;
                const figure = marker(photo);
                if (figure) {
                    setPhotoCaption(figure.querySelector('figcaption'), photo);
                    const img = figure.querySelector('img');
                    if (img) img.alt = photo.captionTitle || photo.caption || '기사 첨부 사진';
                }
                updateEditorCount();
            };
            heading.addEventListener('input', syncCaption);
            caption.addEventListener('input', syncCaption);
            placement.append(button, alignment, heading, caption);
            li.append(placement);
            return li;
        });
        photoList.replaceChildren(...items);
        updateEditorCount();
    }

    editor.addEventListener('click', (event) => {
        const key = event.target.closest('figure[data-photo]')?.dataset.photo;
        if (!key) return;
        const item = [...photoList.children].find((entry) => entry.dataset.photoKey === key);
        item?.querySelector('input')?.focus();
    });

    function addPhotos(files) {
        if (saving) return;
        let warning = '';
        for (const file of files) {
            if (photos.length >= 8) { warning = '사진은 최대 8장까지 첨부할 수 있습니다.'; break; }
            if (!photoTypes.has(file.type) || !file.size || file.size > 5242880) {
                warning = 'JPG, PNG, WebP 형식의 5MB 이하 사진만 첨부할 수 있습니다.';
                continue;
            }
            const photo = { file, key: 'local-' + crypto.randomUUID(), url: URL.createObjectURL(file), position: 'center', caption: '' };
            photos.push(photo);
            locate(photo, true);
        }
        notify(warning);
        showPhotos();
    }

    fileInput.addEventListener('change', () => { addPhotos(fileInput.files); fileInput.value = ''; });
    const drop = find('.compose-drop');
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('drag-over');
        addPhotos(event.dataTransfer.files);
    });

    if (photos.length) {
        for (const photo of photos) {
            const figure = marker(photo);
            if (figure) {
                photo.position = figure.dataset.position;
                Object.assign(photo, readPhotoCaption(figure));
                figure.contentEditable = 'false';
            }
        }
        photoBucket.createSignedUrls(photos.map(({ path }) => path), 3600).then(({ data }) => {
            for (const photo of photos) {
                photo.url ||= data?.find(({ path }) => path === photo.path)?.signedUrl;
                const figure = marker(photo);
                if (figure && photo.url) figure.prepend(photoImage(photo.url, photo.captionTitle || photo.caption || undefined));
            }
            showPhotos();
        });
        showPhotos();
    }

    return {
        setMember(current, members) {
            if (!article && member?.id !== current.id) {
                this.reset();
                byline = [current.id];
            }
            member = current;
            people = members;
            refreshOmission(!article || (!byline.length && !guests.length));
            void refreshSeries();
        },
        refreshSeries,
        reset() {
            form.reset();
            editor.replaceChildren();
            selection = null;
            byline = member ? [member.id] : [];
            guests = [];
            allowsOmission = false;
            selectedSeries = '';
            series.replaceChildren(new Option('선택 안 함', ''));
            for (const photo of photos) if (photo.file) URL.revokeObjectURL(photo.url);
            photos = [];
            showPhotos();
            refreshOmission();
            if (member) void refreshSeries('');
            notify();
        },
        async save(commit) {
            if (saving || series.disabled) return false;
            notify();
            const body = editor.innerText.trim();
            const safe = document.createElement('div');
            safe.append(formattedBody(editor.innerHTML));
            const fields = {
                title: title.value.trim(), article_label: label.value, subtitle: subtitle.value.trim(), body, body_html: safe.innerHTML,
                sector: sector.value, category: form.elements.category.value || null, series_id: selectedSeries || null,
                byline: omitByline.checked ? [] : [...byline],
                guest_byline: omitByline.checked ? [] : [...guests], photo_paths: [],
            };
            if (!fields.title || !body || body.length > 50000 || new Blob([fields.body_html]).size > 400000) {
                notify('제목과 본문을 입력해 주세요. 본문은 5만 자까지 입력할 수 있습니다.');
                return false;
            }
            if (!allowsOmission && !byline.length && !guests.length) {
                notify('기자 또는 외부 기고자를 한 명 이상 추가해 주세요.'); return false;
            }
            if (photos.some((photo) => (photo.file || photo.caption || photo.captionTitle) && !marker(photo))) {
                notify('첨부 사진을 본문에 배치해 주세요. 본문에 커서를 놓고 사진의 삽입 버튼을 누르면 됩니다.');
                return false;
            }
            if (fields.guest_byline.length && !canAddGuest()) { notify('이 섹터의 외부 기고자를 등록할 권한이 없습니다.'); return false; }
            if (!omitByline.checked && (guest.value.trim() || writer.value)) {
                notify('입력하거나 선택한 이름은 추가 버튼을 눌러 등록해 주세요.'); return false;
            }
            const uploaded = [];
            saving = true;
            form.inert = true;
            try {
                for (const photo of photos) {
                    if (photo.path) { fields.photo_paths.push(photo.path); continue; }
                    const path = member.id + '/' + crypto.randomUUID() + '.' + photoTypes.get(photo.file.type);
                    const { error } = await photoBucket.upload(path, photo.file);
                    if (error) { notify('사진을 업로드하지 못했습니다. 다시 시도해 주세요.'); return false; }
                    uploaded.push(path);
                    fields.photo_paths.push(path);
                    const figure = [...safe.querySelectorAll('figure[data-photo]')].find((item) => item.dataset.photo === photo.key);
                    if (figure) figure.dataset.photo = path;
                }
                fields.body_html = safe.innerHTML;
                await commit(fields);
                uploaded.length = 0;
                return true;
            } finally {
                if (uploaded.length) await photoBucket.remove(uploaded);
                form.inert = false;
                saving = false;
            }
        },
    };
}
