import { supabase } from './supabase.js';
import { createArticleAudioField } from './article-audio-editor.js?v=1';
import { formattedBody, photoBucket, photoFigure, photoImage, readPhotoCaption, renderBody, setPhotoCaption, setPhotoOptions } from './article-content.js?v=paragraph-breaks-1';
import { openPhotoDialog } from './photo-dialog.js?v=reuse-library-photo-1';
import { connectPhotoLibrary } from './photo-library.js?v=unpublished-library-1';
import { seriesFor } from './series.js';

const photoTypes = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const editors = new Set(['owner', 'director', 'department_head']);
const alignCommands = new Map([
    ['justifyLeft', 'left'], ['justifyCenter', 'center'], ['justifyRight', 'right'], ['justifyFull', 'justify'],
]);
const paragraphBlocks = 'p, div, h2, h3, li, blockquote';
const rootBlocks = paragraphBlocks + ', figure, ul, ol';

function smartQuote(mark, before) {
    const opens = !before || /[\s([{<«‹“‘「『【〈《〔〖–—]/u.test(before);
    return mark === "'" ? (opens ? '‘' : '’') : (opens ? '“' : '”');
}

function enableInputPunctuation(field) {
    let ellipsisOffset = -1;
    let replacing = false;

    function replace(event, start, end, text) {
        const length = field.value.length - (end - start) + text.length;
        if (field.maxLength >= 0 && length > field.maxLength) return false;
        event.preventDefault();
        replacing = true;
        try {
            field.setSelectionRange(start, end);
            if (!document.execCommand('insertText', false, text)) {
                field.setRangeText(text, start, end, 'end');
                field.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } finally {
            replacing = false;
        }
        return true;
    }

    field.addEventListener('beforeinput', event => {
        if (replacing) return;
        const previous = ellipsisOffset;
        ellipsisOffset = -1;
        if (!event.cancelable || event.isComposing) return;

        const { value, selectionStart: start, selectionEnd: end } = field;
        if (start === null || end === null) return;
        if (event.inputType === 'deleteContentBackward' && start === end && start === previous && value[start - 1] === '…') {
            replace(event, start - 1, start, '...');
            return;
        }
        if (event.inputType !== 'insertText') return;
        if (event.data === '.' && start === end && start >= 2 && value.slice(start - 2, start) === '..') {
            if ((field.maxLength < 0 || value.length < field.maxLength) && replace(event, start - 2, end, '…')) {
                ellipsisOffset = field.selectionStart;
            }
            return;
        }
        if (event.data === "'" || event.data === '"') replace(event, start, end, smartQuote(event.data, value[start - 1]));
    });

    field.addEventListener('keydown', event => {
        if (event.key !== 'Backspace') ellipsisOffset = -1;
    });
    for (const event of ['pointerdown', 'blur', 'compositionstart', 'input']) {
        field.addEventListener(event, () => {
            if (!replacing) ellipsisOffset = -1;
        });
    }
}

export function articleComposer(form, article = null, { contentOnly = false } = {}) {
    form.replaceChildren(document.getElementById('compose-fields').content.cloneNode(true));
    const find = (name) => form.querySelector(name);
    const { title, subtitle, sector, category, series, writer, guest, guestPosition, omitByline, printIssue, printPage } = form.elements;
    enableInputPunctuation(title);
    enableInputPunctuation(subtitle);
    const editor = find('.compose-editor');
    const toolbar = find('.compose-toolbar');
    const photoList = find('[data-thumbs]');
    const feedback = find('[data-compose-feedback]');
    const audio = createArticleAudioField(form, article?.audio_path);
    let member;
    let people = [];
    let byline = [...(article?.byline || [])];
    let guests = (article?.guest_byline || []).map((name, index) => ({
        name, position: article.guest_byline_positions?.[index] || '',
    }));
    let photos = (article?.photo_paths || []).map((path) => ({ path, key: path, position: 'center', caption: '' }));
    let selection;
    let saving = false;
    let seriesRequest = 0;
    let selectedSeries = article?.series_id || '';
    const issue = form.elements.issue;
    const issueTitle = form.elements.issueTitle;
    let selectedIssue = article?.issue_id || '';
    let issueRequest = 0;
    let issueSaving = false;
    let allowsOmission = false;

    const label = form.elements.articleLabel;
    if (contentOnly) find('.compose-section-fields').hidden = true;
    label.value = article?.article_label || '';
    title.value = article?.title || '';
    subtitle.value = article?.subtitle || '';
    printIssue.value = article?.print_issue ?? '';
    printPage.value = article?.print_page ?? '';
    renderBody(editor, article || {});
    if (!editor.hasChildNodes()) seedEditor();
    editor.addEventListener('focus', () => {
        document.execCommand('defaultParagraphSeparator', false, 'p');
    });
    updateEditorCount();

    function seedEditor() {
        const paragraph = document.createElement('p');
        paragraph.append(document.createElement('br'));
        editor.replaceChildren(paragraph);
    }

    function wrapLeadingText() {
        const firstBlock = [...editor.children].find(node =>
            node.matches('p, div, figure, blockquote, ul, ol, h2, h3'));
        if (!firstBlock || editor.firstChild === firstBlock) return;

        const paragraph = document.createElement('p');
        while (editor.firstChild !== firstBlock) paragraph.append(editor.firstChild);
        if (paragraph.textContent.trim() || paragraph.querySelector('br')) {
            editor.prepend(paragraph);
        }
    }

    function notify(message = '') {
        feedback.textContent = message;
    }

    function updateEditorCount() {
        const copy = editor.innerText.trim();
        editor.dataset.empty = String(!copy && !editor.querySelector('figure[data-photo]'));
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

    async function refreshIssues() {
        const request = ++issueRequest;
        issue.disabled = true;
        const { data, error } = await supabase.from('evere_issues').select('id,title').order('issue_number', { ascending: false });
        if (request !== issueRequest) return;
        if (error) {
            notify('이슈 목록을 불러오지 못했습니다. 기사 화면을 다시 열어 주세요.');
            return;
        }
        issue.replaceChildren(new Option('선택 안 함', ''), ...data.map(({ id, title }) =>
            new Option(title, id, false, id === selectedIssue)));
        issue.disabled = false;
    }

    issue.addEventListener('change', () => { selectedIssue = issue.value; });
    const addIssue = find('[data-add-issue]');
    addIssue.addEventListener('click', async () => {
        if (issue.disabled || issueSaving) return;
        const title = issueTitle.value.trim();
        if (!title) { notify('이슈 이름을 입력해 주세요.'); issueTitle.focus(); return; }
        const request = issueRequest;
        issueSaving = addIssue.disabled = true;
        try {
            const { data, error } = await supabase.from('evere_issues').insert({ title }).select('id,title').single();
            if (request !== issueRequest) return;
            if (error) {
                notify(error.code === '23505' ? '같은 이름의 이슈가 있습니다.' : '이슈를 추가하지 못했습니다.');
                return;
            }
            selectedIssue = data.id;
            issue.prepend(new Option(data.title, data.id));
            issue.value = selectedIssue;
            issueTitle.value = '';
            notify();
        } catch {
            if (request === issueRequest) notify('이슈를 추가하지 못했습니다.');
        } finally {
            issueSaving = addIssue.disabled = false;
        }
    });
    issueTitle.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            addIssue.click();
        }
    });

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
        return !contentOnly && editors.has(member?.role) &&
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
                (!article || contentOnly) && id === member.id && ['citizen', 'reporter'].includes(member.role));
        }
        for (const entry of guests) {
            const label = [entry.name, entry.position].filter(Boolean).join(' ');
            append(label + ' · 외부 기고', () => { guests = guests.filter(value => value !== entry); }, contentOnly);
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
        if (!canAddGuest()) return;
        const name = guest.value.trim();
        const position = guestPosition.value.trim();
        if (!name || !position) {
            notify('외부 기고자의 이름과 직책을 입력해 주세요.');
            (name ? guestPosition : guest).focus();
            return;
        }
        if (guests.some(entry => entry.name === name && entry.position === position)) return;
        if (addWriter({ name, position }, guests)) {
            guest.value = '';
            guestPosition.value = '';
        }
    }
    find('[data-add-guest]').addEventListener('click', addGuest);
    for (const field of [guest, guestPosition]) {
        field.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addGuest(); }
        });
    }
    function refreshOmission(defaultOmit = true) {
        const eligible = (sector.value === 'opinion' && category.value === 'editorial') ||
            (sector.value === 'health' && category.value === 'obituaries');
        if (!eligible || !allowsOmission) omitByline.checked = eligible && defaultOmit;
        allowsOmission = eligible;
        find('[data-omit-byline]').hidden = !eligible || (contentOnly && guests.length > 0);
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

    function selectedEditorRange() {
        const current = window.getSelection();
        if (!current?.rangeCount) return null;
        if (!editor.contains(current.anchorNode) && !editor.contains(current.focusNode)) return null;

        const range = current.getRangeAt(0).cloneRange();
        if (!range.intersectsNode(editor)) return null;
        if (!editor.contains(range.startContainer)) range.setStart(editor, 0);
        if (!editor.contains(range.endContainer)) range.setEnd(editor, editor.childNodes.length);
        return range;
    }

    function rememberSelection() {
        const range = selectedEditorRange();
        if (range) selection = range;
    }

    for (const event of ['keyup', 'pointerup', 'input', 'blur']) editor.addEventListener(event, rememberSelection);

    function alignParagraphs(range, alignment) {
        const locked = node => node.closest('figure, [contenteditable="false"]');
        if (range.collapsed) {
            const container = range.startContainer.nodeType === Node.ELEMENT_NODE
                ? range.startContainer : range.startContainer.parentElement;
            const current = container.closest(paragraphBlocks);
            if (current !== editor && editor.contains(current) && !locked(current)) {
                current.style.textAlign = alignment;
                return;
            }
            if (container === editor && editor.children.length === 1 && editor.firstElementChild.matches(paragraphBlocks)) {
                editor.firstElementChild.style.textAlign = alignment;
                return;
            }
        }

        for (const block of editor.querySelectorAll(paragraphBlocks)) {
            if (!locked(block) && range.intersectsNode(block)) block.style.textAlign = alignment;
        }
        // Legacy paragraphs or pasted text can include text directly under the editor.
        let run = [];
        let selected = false;
        function wrapRun() {
            if (selected && run.length) {
                const paragraph = document.createElement('p');
                paragraph.style.textAlign = alignment;
                run[0].before(paragraph);
                paragraph.append(...run);
            }
            run = [];
            selected = false;
        }
        const inline = [...editor.childNodes].map(node => [
            node, node.nodeType === Node.ELEMENT_NODE && node.matches(rootBlocks), range.intersectsNode(node),
        ]);
        for (const [node, isBlock, included] of inline) {
            if (isBlock) wrapRun();
            else {
                run.push(node);
                selected ||= included;
            }
        }
        wrapRun();
    }

    function applyFormat(command, value) {
        const range = selectedEditorRange() || selection;
        editor.focus();
        if (range && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
            const current = window.getSelection();
            current.removeAllRanges();
            current.addRange(range);
        }
        const alignment = alignCommands.get(command);
        if (alignment) {
            const active = selectedEditorRange();
            if (active) alignParagraphs(active, alignment);
        } else {
            document.execCommand(command, false, value);
        }
        rememberSelection();
        updateEditorCount();
    }
    let lastEllipsis = null;
    let replacingPunctuation = false;

    function editorRange() {
        const current = window.getSelection();
        if (!current?.rangeCount) return null;
        const range = current.getRangeAt(0);
        return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
    }

    function replacePunctuation(event, original, target, text) {
        const current = window.getSelection();
        replacingPunctuation = true;
        let inserted;
        try {
            current.removeAllRanges();
            current.addRange(target);
            inserted = document.execCommand('insertText', false, text);
        } finally {
            replacingPunctuation = false;
        }
        if (!inserted) {
            current.removeAllRanges();
            current.addRange(original);
            return false;
        }
        event.preventDefault();
        rememberSelection();
        updateEditorCount();
        return true;
    }

    function previousQuoteCharacter(range) {
        const node = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
            return node.data.slice(range.startOffset - 1, range.startOffset);
        }
        const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        const block = parent.closest('p, div, blockquote, li');
        const preceding = range.cloneRange();
        preceding.selectNodeContents(block && editor.contains(block) ? block : editor);
        preceding.setEnd(node, range.startOffset);
        const end = preceding.cloneContents().lastChild;
        if (end?.nodeName === 'BR' || end?.nodeName === 'DIV' || end?.nodeName === 'P') return '';
        return preceding.toString().slice(-1);
    }

    editor.addEventListener('beforeinput', (event) => {
        if (replacingPunctuation) return;
        const previous = lastEllipsis;
        lastEllipsis = null;
        if (!event.cancelable || event.isComposing) return;

        const range = editorRange();
        if (!range) return;
        const node = range.startContainer;
        const offset = range.startOffset;
        const textNode = node.nodeType === Node.TEXT_NODE;
        const target = range.cloneRange();
        if (event.inputType === 'deleteContentBackward' && previous && range.collapsed &&
            node === previous.node && offset === previous.offset && node.data[offset - 1] === '…') {
            target.setStart(node, offset - 1);
            replacePunctuation(event, range.cloneRange(), target, '...');
            return;
        }
        if (event.inputType !== 'insertText') return;
        if (event.data === '.' && range.collapsed && textNode && offset >= 2 && node.data.slice(offset - 2, offset) === '..') {
            target.setStart(node, offset - 2);
            if (replacePunctuation(event, range.cloneRange(), target, '…')) {
                const caret = editorRange();
                if (caret?.collapsed && caret.startContainer.nodeType === Node.TEXT_NODE) {
                    lastEllipsis = { node: caret.startContainer, offset: caret.startOffset };
                }
            }
            return;
        }
        if (event.data !== "'" && event.data !== '"') return;
        const before = previousQuoteCharacter(range);
        replacePunctuation(event, range.cloneRange(), target, smartQuote(event.data, before));
    });
    editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Backspace') lastEllipsis = null;
    });
    for (const event of ['pointerdown', 'blur', 'compositionstart', 'input']) {
        editor.addEventListener(event, () => {
            if (!replacingPunctuation) lastEllipsis = null;
        });
    }

    toolbar.addEventListener('mousedown', (event) => {
        if (event.target.closest('button')) event.preventDefault();
    });
    toolbar.addEventListener('click', (event) => {
        if (event.target.closest('[data-insert-photo]')) {
            void configurePhoto();
            return;
        }
        const control = event.target.closest('[data-command]');
        if (control) applyFormat(control.dataset.command, control.dataset.text);
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
    editor.addEventListener('input', event => {
        if (event.inputType === 'insertParagraph') {
            wrapLeadingText();
            rememberSelection();
        }
        updateEditorCount();
    });

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
            const options = document.createElement('button');
            options.type = 'button';
            options.textContent = '사진 옵션';
            options.addEventListener('click', () => void configurePhoto({ photo }));
            placement.append(button, options);
            li.append(placement);
            return li;
        });
        photoList.replaceChildren(...items);
        updateEditorCount();
    }

    editor.addEventListener('click', (event) => {
        const key = event.target.closest('figure[data-photo]')?.dataset.photo;
        if (!key) return;
        const photo = photos.find(item => item.key === key);
        if (photo) void configurePhoto({ photo });
    });

    let activePhotoDialog;
    let photoBatch = 0;
    async function configurePhoto({ file, photo, libraryPhoto } = {}) {
        if (saving || activePhotoDialog) return false;
        if (libraryPhoto && photos.some(({ path }) => path === libraryPhoto.path)) {
            notify('이미 첨부한 사진입니다. 첨부 목록에서 위치나 캡션을 바꿀 수 있습니다.');
            return false;
        }
        if (!photo && photos.length >= 8) { notify('사진은 최대 8장까지 첨부할 수 있습니다.'); return false; }
        const dialog = openPhotoDialog({ file, photo, libraryPhoto });
        activePhotoDialog = dialog;
        const options = await dialog.result;
        if (activePhotoDialog !== dialog) return false;
        activePhotoDialog = null;
        if (!options) return false;

        if (photo) {
            Object.assign(photo, options, { file: photo.file });
            const figure = marker(photo);
            if (figure) {
                setPhotoOptions(figure, photo);
                setPhotoCaption(figure.querySelector('figcaption'), photo);
                const image = figure.querySelector('img');
                if (image) image.alt = photo.captionTitle || photo.caption || '기사 첨부 사진';
            }
        } else {
            const next = options.path
                ? { ...options, key: options.path }
                : { ...options, key: 'local-' + crypto.randomUUID(), url: URL.createObjectURL(options.file) };
            photos.push(next);
            locate(next, true);
        }
        notify();
        showPhotos();
        return true;
    }

    async function addPhotos(files) {
        if (saving || activePhotoDialog) return;
        const current = ++photoBatch;
        for (const file of Array.from(files)) {
            if (current !== photoBatch || !await configurePhoto({ file })) break;
        }
    }

    const disconnectPhotoLibrary = connectPhotoLibrary(find('[data-photo-library]'), libraryPhoto => configurePhoto({ libraryPhoto }));

    if (photos.length) {
        for (const photo of photos) {
            const figure = marker(photo);
            if (figure) {
                photo.position = figure.dataset.position;
                photo.size = figure.dataset.photoWidth || 'original';
                photo.captionAlign = figure.dataset.captionAlign || 'left';
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
            find('[data-issue-create]').hidden = !['owner', 'director'].includes(member.role);
            void refreshIssues();
            refreshOmission(!article || (!byline.length && !guests.length));
            void refreshSeries();
        },
        refreshSeries,
        reset() {
            if (article) disconnectPhotoLibrary();
            photoBatch++;
            activePhotoDialog?.close();
            activePhotoDialog = null;
            form.reset();
            audio.reset();
            seedEditor();
            selection = null;
            lastEllipsis = null;
            byline = member ? [member.id] : [];
            guests = [];
            allowsOmission = false;
            selectedSeries = '';
            selectedIssue = '';
            issueRequest++;
            issue.value = '';
            series.replaceChildren(new Option('선택 안 함', ''));
            for (const photo of photos) if (photo.file) URL.revokeObjectURL(photo.url);
            photos = [];
            showPhotos();
            refreshOmission();
            if (member) void refreshSeries('');
            if (member && !article) void refreshIssues();
            notify();
        },
        async save(commit) {
            if (saving || issueSaving || (!contentOnly && series.disabled)) return false;
            if (issueTitle.value.trim()) { notify('새 이슈 이름 옆의 추가 버튼을 눌러 주세요.'); return false; }
            notify();
            const body = editor.innerText.trim();
            const safe = document.createElement('div');
            safe.append(formattedBody(editor.innerHTML));
            for (const block of safe.children) {
                if (block.matches(rootBlocks) && !block.matches('figure') && !block.style.textAlign) block.style.textAlign = 'justify';
            }
            for (const [input, name] of [[printIssue, '호수'], [printPage, '면수']]) {
                const number = input.value.trim();
                if (number && (!/^[0-9]+$/.test(number) || Number(number) < 1 || Number(number) > 2147483647)) {
                    notify(name + '는 1 이상의 정수로 입력해 주세요.');
                    input.focus();
                    return false;
                }
            }
            const fields = {
                print_issue: printIssue.value.trim() ? Number(printIssue.value) : null,
                print_page: printPage.value.trim() ? Number(printPage.value) : null,
                title: title.value.trim(), article_label: label.value, subtitle: subtitle.value.trim(), body, body_html: safe.innerHTML,
                sector: sector.value, category: form.elements.category.value || null, series_id: selectedSeries || null, issue_id: selectedIssue || null,
                byline: omitByline.checked ? [] : [...byline],
                guest_byline: omitByline.checked ? [] : guests.map(entry => entry.name),
                guest_byline_positions: omitByline.checked || !guests.some(entry => entry.position)
                    ? [] : guests.map(entry => entry.position),
                photo_paths: [],
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
            if (!contentOnly && fields.guest_byline.length && !canAddGuest()) { notify('이 섹터의 외부 기고자를 등록할 권한이 없습니다.'); return false; }
            if (!omitByline.checked && (guest.value.trim() || guestPosition.value.trim() || writer.value)) {
                notify('입력하거나 선택한 이름은 추가 버튼을 눌러 등록해 주세요.'); return false;
            }
            if (audio.error()) { notify(audio.error()); return false; }
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
                fields.audio_path = await audio.stage(member.id);
                await commit(fields);
                audio.committed();
                uploaded.length = 0;
                return true;
            } finally {
                await audio.discard();
                if (uploaded.length) await photoBucket.remove(uploaded);
                form.inert = false;
                saving = false;
            }
        },
    };
}
