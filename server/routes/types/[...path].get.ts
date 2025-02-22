import { getHeader } from 'h3';
import { generateETagForFile } from '../../utils/hashUtils';
import { convertToWebp } from '../../utils/convertToWebp';

// Load the service_metadata.json into memory
const serviceMetadata = await (Bun.file('./images/service_metadata.json')).json();

export default defineEventHandler(async (event) => {
    // Example: 11568/bpc
    const path = event.context.params.path;
    const [id, type] = path.split('/');

    // Find the data in the serviceMetadata
    const data = serviceMetadata[id];
    if (!data) {
        return 'Image not found';
    }

    if (!type) {
        return { error: 'Type not defined', validTypes: Object.keys(data) };
    }

    // Original image path (unchanged)
    const imagePath = data[type];
    const fullImagePath = `./images/${imagePath}`;

    // Check if the client accepts WebP
    const acceptHeader = getHeader(event, 'accept') || '';
    const webpRequested = acceptHeader.includes('image/webp');

    // When WebP is requested, store/load the converted file from cache (e.g. cache/types)
    let image: ArrayBuffer;
    let etag: string;
    if (webpRequested) {
        const cachePath = `./cache/types/${id}-${type}.webp`;
        if (await Bun.file(cachePath).exists()) {
            image = await Bun.file(cachePath).arrayBuffer();
        } else {
            const originalImage = await (Bun.file(fullImagePath)).arrayBuffer();
            image = await convertToWebp(originalImage);
            await Bun.file(cachePath).write(image);
        }
        etag = await generateETagForFile(cachePath);
    } else {
        image = await (Bun.file(fullImagePath)).arrayBuffer();
        etag = await generateETagForFile(fullImagePath);
    }

    const ifNoneMatch = getHeader(event, 'if-none-match');
    if (ifNoneMatch === etag) {
        return new Response(null, {
            status: 304,
            headers: { 'ETag': etag }
        });
    }

    return new Response(image, {
        headers: {
            'Content-Type': webpRequested ? 'image/webp' : 'image/png',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': etag,
            'Last-Modified': new Date(Bun.file(fullImagePath).lastModified).toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': new Date(Date.now() + 2592000).toUTCString()
        },
    });
});
