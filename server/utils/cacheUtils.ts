export function canonicalQuery(query: Record<string, string>): string {
    const keys = Object.keys(query).sort();
    return keys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
}

export function getCacheFilename(id: string, query: Record<string, string>, ext: string, basePath: string): string {
    const q = canonicalQuery(query);
    return q ? `${basePath}/${id}-${q}.${ext}` : `${basePath}/${id}.${ext}`;
}
