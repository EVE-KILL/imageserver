import { getHeader, getQuery } from 'h3';
import { generateETagForFile } from '../../utils/hashUtils';
import { convertToWebp } from '../../utils/convertToWebp';
import { resizeImage } from '../../utils/resizeImage';

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

    // Retrieve query parameters
    const query = getQuery(event) || {};
    // Determine if WebP is requested
    const acceptHeader = getHeader(event, 'accept') || '';
    const webpRequested = acceptHeader.includes('image/webp');
    // Determine if a resize is requested
    const validSizes = [8,16,32,64,128,256,512,1024];
    const sizeParam = parseInt(query.size, 10);
    const requestedSize = validSizes.includes(sizeParam) ? sizeParam : null;

    // Determine desired extension and cache file name.
    // For a resized image, include the size in the cache filename.
    let cachePath = '';
    if (requestedSize) {
        cachePath = `./cache/types/${id}-${type}-${requestedSize}.${webpRequested ? 'webp' : 'png'}`;
    } else if (webpRequested) {
        cachePath = `./cache/types/${id}-${type}.webp`;
    } else {
        // No conversion; serve original image.
        cachePath = fullImagePath;
    }

    let image: ArrayBuffer;
    if (requestedSize || webpRequested) {
        if (await Bun.file(cachePath).exists()) {
            image = await Bun.file(cachePath).arrayBuffer();
        } else {
            // Load original image
            const originalImage = await (Bun.file(fullImagePath)).arrayBuffer();
            // If resizing is requested, process it.
            let processedImage = originalImage;
            if (requestedSize) {
                processedImage = await resizeImage(originalImage, requestedSize);
            }
            // If WebP is also requested, then convert processed image to WebP.
            if (webpRequested) {
                processedImage = await convertToWebp(processedImage);
            }
            // Write processed version to cache
            await Bun.file(cachePath).write(processedImage);
            image = processedImage;
        }
    } else {
        // No size or webp conversion; serve original image.
        image = await (Bun.file(fullImagePath)).arrayBuffer();
    }

    const etag = await generateETagForFile(cachePath);
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
