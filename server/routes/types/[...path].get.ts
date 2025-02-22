import { getHeader, getQuery } from 'h3';
import { generateETagForFile } from '../../utils/hashUtils';
import { convertToWebp } from '../../utils/convertToWebp';
import { resizeImage } from '../../utils/resizeImage';

// Load the service_metadata.json into memory
const serviceMetadata = await (Bun.file('./images/service_metadata.json')).json();

export default defineEventHandler(async (event) => {
    // Parse path params
    const path = event.context.params.path;
    const [id, type] = path.split('/');

    // Determine source: local if serviceMetadata[id] exists and has a value for [type]
    const data = serviceMetadata[id] || {};
    const localEntry = data[type];

    // Retrieve query parameters and check for size and WebP support
    const query = getQuery(event) || {};
    const validSizes = [8,16,32,64,128,256,512,1024];
    const sizeParam = parseInt(query.size, 10);
    const requestedSize = validSizes.includes(sizeParam) ? sizeParam : null;
    const acceptHeader = getHeader(event, 'accept') || '';
    const webpRequested = acceptHeader.includes('image/webp');

    // Set base extension based on source: local images are PNG, upstream images are JPEG
    const baseExt = localEntry ? 'png' : 'jpeg';
    const desiredExt = webpRequested ? 'webp' : baseExt;

    // Construct cache path. Include size if applicable.
    let cachePath = '';
    if (requestedSize) {
        cachePath = `./cache/types/${id}-${type}-${requestedSize}.${desiredExt}`;
    } else {
        cachePath = `./cache/types/${id}-${type}.${desiredExt}`;
    }

    let image: ArrayBuffer;
    let etag: string;

    if (localEntry) {
        const fullImagePath = `./images/${localEntry}`;
        // If no conversion is requested, serve the original file directly.
        if (!requestedSize && !webpRequested) {
            cachePath = fullImagePath;
        }
        image = await loadOrProcessImage(fullImagePath, cachePath, requestedSize, webpRequested);
        etag = await generateETagForFile(cachePath);
    } else {
        // Not in the local dump: fetch from upstream
        // Build upstream URL with any query parameters (except "size" because we handle resizing locally)
        const upstreamQuery = { ...query };
        delete upstreamQuery.size;
        const qs = Object.keys(upstreamQuery).length > 0 ? '?' + new URLSearchParams(upstreamQuery) : '';
        const upstreamURL = `https://images.evetech.net/types/${id}/${type}${qs}`;
        image = await loadOrProcessImage(upstreamURL, cachePath, requestedSize, webpRequested, true);
        etag = await generateETagForFile(cachePath);
    }

    const ifNoneMatch = getHeader(event, 'if-none-match');
    if (ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers: { 'ETag': etag } });
    }

    return new Response(image, {
        headers: {
            'Content-Type': webpRequested ? 'image/webp' : (baseExt === 'png' ? 'image/png' : 'image/jpeg'),
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': etag,
            'Last-Modified': new Date(Bun.file(localEntry ? `./images/${localEntry}` : cachePath).lastModified).toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': new Date(Date.now() + 2592000).toUTCString()
        },
    });
});

// Helper: load or process image from a source (file path or URL)
// If upstream is true, fetch the image from the URL; otherwise, load the local file.
async function loadOrProcessImage(
    source: string,
    cachePath: string,
    requestedSize: number | null,
    webpRequested: boolean,
    upstream: boolean = false
): Promise<ArrayBuffer> {
    // If cached file exists, just load it.
    if (await Bun.file(cachePath).exists()) {
        return await Bun.file(cachePath).arrayBuffer();
    }
    let original: ArrayBuffer;
    if (upstream) {
        const res = await fetch(source);
        original = await res.arrayBuffer();
    } else {
        original = await (Bun.file(source)).arrayBuffer();
    }
    let processed = original;
    if (requestedSize) {
        processed = await resizeImage(processed, requestedSize);
    }
    if (webpRequested) {
        processed = await convertToWebp(processed);
    }
    // Save processed version into cache.
    await Bun.file(cachePath).write(processed);
    return processed;
}
