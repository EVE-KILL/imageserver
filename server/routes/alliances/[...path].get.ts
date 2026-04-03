import { getShardedPath, ensureShardDir } from "../../utils/cacheUtils";
import { generateETag } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { convertToWebp } from "../../utils/convertToWebp";
import { resizeImage } from "../../utils/resizeImage";
import { saveMetadata, touchAccessed } from "../../utils/metadataDb";
import { lruGet, lruSet, lruKey } from "../../utils/lruCache";

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

	const desiredFormat = webpRequested ? "webp" : "png";
	const cachePath = getShardedPath("alliances", id, "original");

	const cacheKey = lruKey(cachePath, requestedSize, desiredFormat);
	const etag = await generateETag(cachePath, requestedSize, desiredFormat);

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
			"Content-Type": webpRequested ? "image/webp" : "image/png",
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
	if (await Bun.file(cachePath).exists()) {
		touchAccessed(cachePath);
		const original = await Bun.file(cachePath).arrayBuffer();
		return processImage(original, requestedSize, webpRequested);
	}

	const url = `https://images.evetech.net/alliances/${id}/logo`;
	const res = await fetch(url);
	if (!res.ok) {
		throw createError({ statusCode: res.status, statusMessage: `Upstream returned ${res.status} for alliance ${id}` });
	}

	const eveETag = res.headers.get("ETag");
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
