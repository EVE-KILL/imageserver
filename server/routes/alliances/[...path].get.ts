import { getCacheFilename } from '../../utils/cacheUtils';

export default defineEventHandler(async (event) => {
    const path = event.context.params.path;
    const [id, type] = path.split('/');
    const query = getQuery(event) || {};
    const cachePath = getCacheFilename(id, query, 'png', './cache/alliances');

    const image = await getImage(id, query);
    return new Response(image, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=2592000',
            'Vary': 'Accept-Encoding',
            'ETag': 'W/"' + image.byteLength.toString() + '"',
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
