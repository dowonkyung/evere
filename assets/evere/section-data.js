// Published articles use section, category, title, summary, href and an ISO publishedAt.
// An article can also specify series: { id, title, href, image }.
export const articles = [];

export function latestSeries(publishedArticles, section, now = Date.now()) {
    const bySeries = new Map();

    for (const article of publishedArticles) {
        const series = article.series;
        if (article.section !== section || !series?.id || !series.title || !series.href) continue;
        const publishedAt = Date.parse(article.publishedAt);
        if (!Number.isFinite(publishedAt) || publishedAt > now) continue;
        const previous = bySeries.get(series.id);
        if (!previous || publishedAt > previous.publishedAt) {
            bySeries.set(series.id, { ...series, publishedAt });
        }
    }

    if (bySeries.size < 3) return [];
    return [...bySeries.values()].sort((a, b) =>
        b.publishedAt - a.publishedAt || a.id.localeCompare(b.id)
    ).slice(0, 3);
}
