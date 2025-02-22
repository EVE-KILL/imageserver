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

    // Fetch the image and return it
    const image = await (Bun.file(`./images/${imagePath}`)).arrayBuffer();
    const imageLastModified = new Date(Bun.file(`./images/${imagePath}`).lastModified);
    const imageETag = 'W/"' + image.byteLength.toString() + '"';
    const imageExpires = new Date(Date.now() + 2592000).toUTCString();
    return new Response(image, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': imageETag,
            'Last-Modified': imageLastModified.toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': imageExpires
        },
    });
});
