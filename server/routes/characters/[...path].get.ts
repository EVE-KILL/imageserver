import { getCacheFilename } from '../../utils/cacheUtils';

export default defineEventHandler(async (event) => {
    // Example: 11568/bpc
    const path = event.context.params.path;
    const [id, type] = path.split('/');
    const query = getQuery(event) || {};
    const cachePath = getCacheFilename(id, query, 'jpg', './cache/characters');

    const image = await getImage(id, query);
    return new Response(image, {
        headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': 'W/"' + image.byteLength.toString() + '"',
            'Last-Modified': new Date(Bun.file(cachePath).lastModified).toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': new Date(Date.now() + 2592000).toUTCString()
        },
    });
});

async function fetchImage(id: string, query: Record<string, string>): Promise<ArrayBuffer>
{
  const url = `https://images.evetech.net/characters/${id}/portrait${query ? '?' + new URLSearchParams(query) : ''}`;
  const response = await fetch(url);
  return await response.arrayBuffer();
}

// Store the image in the cache located at ./cache/characters/
async function storeImage(id: string, image: ArrayBuffer, query: Record<string, string>): Promise<void>
{
  const cachePath = getCacheFilename(id, query, 'jpg', './cache/characters');
  await Bun.file(cachePath).write(image);
}

// Check if the image exists in the cache
async function imageExists(id: string, query: Record<string, string>): Promise<boolean>
{
  const cachePath = getCacheFilename(id, query, 'jpg', './cache/characters');
  if (!(await Bun.file(cachePath).exists())) return false;
  const stats = await Bun.file(cachePath).stat();
  const imageAge = (Date.now() - stats.mtimeMs) / 1000;
  if (imageAge > 30 * 24 * 60 * 60) {
    await Bun.file(cachePath).delete();
    return false;
  }
  return true;
}

// Get the image from the cache if it exists, otherwise use fetchImage to get it from CCPs image server, and store it in the cache, before returning it
async function getImage(id: string, query: Record<string, string>): Promise<ArrayBuffer>
{
  if (await imageExists(id, query))
  {
    const cachePath = getCacheFilename(id, query, 'jpg', './cache/characters');
    return await Bun.file(cachePath).arrayBuffer();
  }

  // Fetch the image from CCPs image server
  const image = await fetchImage(id, query);

  // Store the image in the cache
  await storeImage(id, image, query);

  return image;
}
