import { getCacheFilename } from '../../utils/cacheUtils';
import { generateETagForFile } from '../../utils/hashUtils';
import { getHeader } from 'h3';
import { convertToWebp } from '../../utils/convertToWebp';

export default defineEventHandler(async (event) => {
    const path = event.context.params.path;
    const [id, type] = path.split('/');
    const query = getQuery(event) || {};

    // Check if WebP is supported
    const acceptHeader = getHeader(event, 'accept') || '';
    const webpRequested = acceptHeader.includes('image/webp');
    // If webp requested, use "webp" else original "jpg"
    const desiredExt = webpRequested ? 'webp' : 'jpg';
    const cachePath = getCacheFilename(id, query, desiredExt, './cache/characters');

    let image: ArrayBuffer;
    if (webpRequested) {
        if (await Bun.file(cachePath).exists()) {
            image = await Bun.file(cachePath).arrayBuffer();
        } else {
            const originalImage = await getImage(id, query);
            image = await convertToWebp(originalImage);
            await Bun.file(cachePath).write(image);
        }
    } else {
        image = await getImage(id, query);
    }

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
