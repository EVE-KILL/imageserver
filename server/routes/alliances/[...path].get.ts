import { getCacheFilename } from '../../utils/cacheUtils';
import { generateETagForFile } from '../../utils/hashUtils';
import { getHeader } from 'h3';
import { convertToWebp } from '../../utils/convertToWebp';

export default defineEventHandler(async (event) => {
    const path = event.context.params.path;
    const [id, type] = path.split('/');
    const query = getQuery(event) || {};

    const acceptHeader = getHeader(event, 'accept') || '';
    const webpRequested = acceptHeader.includes('image/webp');
    const desiredExt = webpRequested ? 'webp' : 'png';
    const cachePath = getCacheFilename(id, query, desiredExt, './cache/alliances');

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
            'Content-Type': webpRequested ? 'image/webp' : 'image/png',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': etag,
            'Last-Modified': new Date(Bun.file(cachePath).lastModified).toUTCString(),
            'Accept-Ranges': 'bytes',
            'Expires': new Date(Date.now() + 2592000).toUTCString()
        },
    });
});

async function fetchImage(id: string, query: Record<string, string>): Promise<ArrayBuffer> {
  const url = `https://images.evetech.net/alliances/${id}/logo${query ? '?' + new URLSearchParams(query) : ''}`;
  const response = await fetch(url);
  return await response.arrayBuffer();
}

async function storeImage(id: string, image: ArrayBuffer, query: Record<string, string>): Promise<void> {
  const cachePath = getCacheFilename(id, query, 'png', './cache/alliances');
  await Bun.file(cachePath).write(image);
}

async function imageExists(id: string, query: Record<string, string>): Promise<boolean> {
  const cachePath = getCacheFilename(id, query, 'png', './cache/alliances');
  if (!(await Bun.file(cachePath).exists())) return false;
  const stats = await Bun.file(cachePath).stat();
  const imageAge = (Date.now() - stats.mtimeMs) / 1000;
  if (imageAge > 30 * 24 * 60 * 60) {
    await Bun.file(cachePath).delete();
    return false;
  }
  return true;
}

async function getImage(id: string, query: Record<string, string>): Promise<ArrayBuffer> {
  if (await imageExists(id, query)) {
    const cachePath = getCacheFilename(id, query, 'png', './cache/alliances');
    return await Bun.file(cachePath).arrayBuffer();
  }
  const image = await fetchImage(id, query);
  await storeImage(id, image, query);
  return image;
}
