const pendingHeader = document.querySelector('#evere-header[data-css-pending]');
if (pendingHeader) {
    const reveal = () => pendingHeader.removeAttribute('data-css-pending');
    const links = [...(pendingHeader.shadowRoot?.querySelectorAll('link[rel="stylesheet"]') || [])];
    if (links.every(link => link.sheet)) {
        reveal();
    } else {
        const timeout = setTimeout(reveal, 2500);
        Promise.all(links.map(link => new Promise(resolve => {
            if (link.sheet) resolve();
            else {
                link.addEventListener('load', resolve, { once: true });
                link.addEventListener('error', resolve, { once: true });
            }
        }))).then(() => {
            clearTimeout(timeout);
            reveal();
        });
    }
}
