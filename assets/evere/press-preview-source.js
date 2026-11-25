export function previewPath(row) {
    if (row.preview_path) return row.preview_path;
    if (row.revision !== 0 || !/^default-templates\/(front|odd|even)\.indd$/.test(row.source_path || '')) return null;
    return row.source_path.replace(/\.indd$/, '.jpg');
}

