import { getCacheFilename } from '../../utils/cacheUtils';
import { generateETagForFile } from '../../utils/hashUtils';
import { getHeader, getQuery } from 'h3';
import { convertToWebp } from '../../utils/convertToWebp';
import { resizeImage } from '../../utils/resizeImage';

export default defineEventHandler(async (event) => {
    const path = event.context.params.path;
    const [id, type] = path.split('/');
    // For characters we use the /portrait endpoint.
    const params = getQuery(event) || {};
    const requestedSize = params.size ? parseInt(params.size, 10) : null;
    delete params.size;

    const acceptHeader = getHeader(event, 'accept') || '';
    const webpRequested = acceptHeader.includes('image/webp');
    const desiredExt = webpRequested ? 'webp' : 'jpg';

    // Construct cache path. If a resize is requested, include the size value.
    let cachePath = requestedSize
        ? `./cache/characters/${id}-${requestedSize}.${desiredExt}`
        : getCacheFilename(id, params, desiredExt, './cache/characters');

    const image = await loadOrProcessImage(id, cachePath, requestedSize, webpRequested);
    const etag = await generateETagForFile(cachePath);
    const ifNoneMatch = getHeader(event, 'if-none-match');
    if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: { 'ETag': etag } });
    }

    return new Response(image, {
        headers: {
            'Content-Type': webpRequested ? 'image/webp' : 'image/jpeg',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': etag,
            'Last-Modified': new Date(Bun.file(cachePath).lastModified).toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': new Date(Date.now() + 2592000).toUTCString()
        },
    });
});

// Helper: Always fetch the full-quality image from upstream without passing "?size".
// For characters the endpoint is /portrait.
async function loadOrProcessImage(
    id: string,
    cachePath: string,
    requestedSize: number | null,
    webpRequested: boolean
): Promise<ArrayBuffer> {
    if (await Bun.file(cachePath).exists()) {
        return await Bun.file(cachePath).arrayBuffer();
    }
    const url = `https://images.evetech.net/characters/${id}/portrait`;
    const res = await fetch(url);
    let original = await res.arrayBuffer();
    let processed = original;
    if (requestedSize) {
        processed = await resizeImage(original, requestedSize);
    }
    if (webpRequested) {
        processed = await convertToWebp(processed);
    }
    await Bun.file(cachePath).write(processed);
    return processed;
}
