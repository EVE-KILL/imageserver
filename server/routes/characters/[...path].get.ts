import { getShardedPath, ensureShardDir } from "../../utils/cacheUtils";
import { generateETag } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { convertToWebp } from "../../utils/convertToWebp";
import { resizeImage } from "../../utils/resizeImage";
import { getDefaultCharacterETag, getOldCharacterImage, initDefaultCharacterETag } from "../../utils/characterUtils";
import { saveMetadata, touchAccessed } from "../../utils/metadataDb";
import { lruGet, lruSet, lruKey } from "../../utils/lruCache";

await initDefaultCharacterETag();

export default defineEventHandler(async (event) => {
	const path = event.context.params.path;
	const [id, type] = path.split("/");

	const params = getQuery(event) || {};
	const requestedSize = params.size ? Number.parseInt(String(params.size), 10) : null;
	delete params.size;

	const imageType = String(params.imagetype || '').toLowerCase();
	delete params.imagetype;

	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;
	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	const desiredFormat = webpRequested ? "webp" : "jpg";

	// Single file on disk per character ID — the original upstream image
	const cachePath = getShardedPath("characters", id, "original");

	// Check LRU first for the exact processed variant
	const cacheKey = lruKey(cachePath, requestedSize, desiredFormat);
	const etag = await generateETag(cachePath, requestedSize, desiredFormat);

	// Handle 304
	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch && ifNoneMatch === etag && await Bun.file(cachePath).exists()) {
		touchAccessed(cachePath);
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	let processed = lruGet(cacheKey);
	if (!processed) {
		processed = await loadOrProcessImage(id, cachePath, requestedSize, webpRequested);
		lruSet(cacheKey, processed);
	} else {
		touchAccessed(cachePath);
	}

	const finalEtag = await generateETag(cachePath, requestedSize, desiredFormat);

	return new Response(processed, {
		headers: {
			"Content-Type": webpRequested ? "image/webp" : "image/jpeg",
			"Cache-Control": "public, max-age=86400",
			Vary: "Accept-Encoding",
			ETag: finalEtag,
			"Last-Modified": new Date(Bun.file(cachePath).lastModified).toUTCString(),
			"Accept-Ranges": "bytes",
			Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
		},
	});
});

async function loadOrProcessImage(
	id: string,
	cachePath: string,
	requestedSize: number | null,
	webpRequested: boolean,
): Promise<ArrayBuffer> {
	// Check if we have the original on disk
	if (await Bun.file(cachePath).exists()) {
		touchAccessed(cachePath);
		const original = await Bun.file(cachePath).arrayBuffer();
		return processImage(original, requestedSize, webpRequested);
	}

	// Fetch from upstream
	const url = `https://images.evetech.net/characters/${id}/portrait`;
	const res = await fetch(url);
	if (!res.ok) {
		throw createError({ statusCode: res.status, statusMessage: `Upstream returned ${res.status} for character ${id}` });
	}

	const eveETag = res.headers.get("ETag");
	const defaultETag = getDefaultCharacterETag();

	// Check if the returned image is the default (missing) character image
	if (eveETag === defaultETag) {
		const oldCharResult = await getOldCharacterImage(id, webpRequested);
		if (oldCharResult.found && oldCharResult.image) {
			let processed = oldCharResult.image;
			if (requestedSize) {
				processed = await resizeImage(processed, requestedSize);
			}
			// Still save the original upstream response so we don't re-fetch
			const original = await res.arrayBuffer();
			await ensureShardDir(cachePath);
			await Bun.file(cachePath).write(original);
			saveMetadata(cachePath, eveETag || 'none', original.byteLength);
			return processed;
		}
	}

	// Save the original upstream image to disk
	const original = await res.arrayBuffer();
	await ensureShardDir(cachePath);
	await Bun.file(cachePath).write(original);
	saveMetadata(cachePath, eveETag || 'none', original.byteLength);

	return processImage(original, requestedSize, webpRequested);
}

async function processImage(
	original: ArrayBuffer,
	requestedSize: number | null,
	webpRequested: boolean,
): Promise<ArrayBuffer> {
	let processed = original;
	if (requestedSize) {
		processed = await resizeImage(processed, requestedSize);
	}
	if (webpRequested) {
		processed = await convertToWebp(processed);
	}
	return processed;
}
