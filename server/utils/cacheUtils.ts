import { promises as fs } from 'node:fs';
import path from 'node:path';

export function canonicalQuery(query: Record<string, string>): string {
    const keys = Object.keys(query).sort();
    return keys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
}

export function getCacheFilename(id: string, query: Record<string, string>, ext: string, basePath: string): string {
    const q = canonicalQuery(query);
    return q ? `${basePath}/${id}-${q}.${ext}` : `${basePath}/${id}.${ext}`;
}

/**
 * Get a sharded cache path for an ID.
 * Uses first 2 digits and next 2 digits of zero-padded ID for directory structure.
 * e.g. ID "2115142978" -> "./cache/characters/21/15/2115142978.original"
 *      ID "123"        -> "./cache/characters/01/23/123.original"
 */
export function getShardedPath(category: string, id: string, suffix: string): string {
    const padded = id.padStart(4, '0');
    return `./cache/${category}/${padded.slice(0, 2)}/${padded.slice(2, 4)}/${id}.${suffix}`;
}

/**
 * Ensure the directory for a sharded cache path exists.
 * Call this before writing a file to a sharded path.
 */
export async function ensureShardDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
}
