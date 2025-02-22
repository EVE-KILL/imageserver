import { getHeader } from 'h3';
import { generateETagForFile } from '../../utils/hashUtils';

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

    // Select the image based on the type
    const imagePath = data[type];
    const fullImagePath = `./images/${imagePath}`;

    const ifNoneMatch = getHeader(event, 'if-none-match');
    const etag = await generateETagForFile(fullImagePath);
    if (ifNoneMatch === etag) {
        return new Response(null, {
            status: 304,
            headers: { 'ETag': etag }
        });
    }

    // Fetch the image and return it
    const image = await (Bun.file(fullImagePath)).arrayBuffer();
    return new Response(image, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': etag,
            'Last-Modified': new Date(Bun.file(fullImagePath).lastModified).toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': new Date(Date.now() + 2592000).toUTCString()
        },
    });
});
