import { getShardedPath, ensureShardDir } from "../../utils/cacheUtils";
import { generateETag } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { processImage } from "../../utils/processImage";
import { getDefaultCharacterETag, getOldCharacterImage, initDefaultCharacterETag } from "../../utils/characterUtils";
import { saveMetadata, touchAccessed } from "../../utils/metadataDb";
import { lruGet, lruSet, lruKey } from "../../utils/lruCache";

// Fire-and-forget — don't block module load if EVE API is slow
initDefaultCharacterETag().catch(err => console.error('Failed to init default character ETag:', err));

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
	const cachePath = getShardedPath("characters", id, "original");

	// Check LRU first
	const cacheKey = lruKey(cachePath, requestedSize, desiredFormat);
	let processed = lruGet(cacheKey);

	if (!processed) {
		processed = await loadOrProcessImage(id, cachePath, requestedSize, webpRequested);
		lruSet(cacheKey, processed);
	} else {
		touchAccessed(cachePath);
	}

	// Generate ETag once, after file is guaranteed to exist on disk
	const etag = await generateETag(cachePath, requestedSize, desiredFormat);
	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch && ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	return new Response(processed, {
		headers: {
			"Content-Type": webpRequested ? "image/webp" : "image/jpeg",
			"Cache-Control": "public, max-age=86400",
			Vary: "Accept-Encoding",
			ETag: etag,
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
	// Read body once
	const original = await res.arrayBuffer();
	const defaultETag = getDefaultCharacterETag();

	// Check if the returned image is the default (missing) character image
	if (eveETag === defaultETag) {
		const oldCharResult = await getOldCharacterImage(id, webpRequested);
		if (oldCharResult.found && oldCharResult.image) {
			// Process with correct webp flag
			const processed = await processImage(oldCharResult.image, requestedSize, webpRequested);
			// Save the original upstream response so we don't re-fetch
			await ensureShardDir(cachePath);
			await Bun.file(cachePath).write(original);
			saveMetadata(cachePath, eveETag || 'none', original.byteLength);
			return processed;
		}
	}

	// Save the original upstream image to disk
	await ensureShardDir(cachePath);
	await Bun.file(cachePath).write(original);
	saveMetadata(cachePath, eveETag || 'none', original.byteLength);

	return processImage(original, requestedSize, webpRequested);
}
