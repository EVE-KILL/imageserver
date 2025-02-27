import { getCacheFilename } from "../../utils/cacheUtils";
import { generateETagForFile } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { convertToWebp } from "../../utils/convertToWebp";
import { resizeImage } from "../../utils/resizeImage";
import { getDefaultCharacterETag, getOldCharacterImage, initDefaultCharacterETag } from "../../utils/characterUtils";

// Initialize the default character ETag on startup
await initDefaultCharacterETag();

export default defineEventHandler(async (event) => {
	const path = event.context.params.path;
	const [id, type] = path.split("/");
	// For characters we use the /portrait endpoint.
	const params = getQuery(event) || {};
	const requestedSize = params.size ? Number.parseInt(params.size, 10) : null;
	delete params.size;

	const acceptHeader = getHeader(event, "accept") || "";
	const webpRequested = acceptHeader.includes("image/webp");
	const desiredExt = webpRequested ? "webp" : "jpg";

	// Construct cache path. If a resize is requested, include the size value.
	const cachePath = requestedSize
		? `./cache/characters/${id}-${requestedSize}.${desiredExt}`
		: getCacheFilename(id, params, desiredExt, "./cache/characters");

	const image = await loadOrProcessImage(
		id,
		cachePath,
		requestedSize,
		webpRequested,
	);
	const etag = await generateETagForFile(cachePath);
	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	return new Response(image, {
		headers: {
			"Content-Type": webpRequested ? "image/webp" : "image/jpeg",
			"Cache-Control": "public, max-age=2592000",
			Vary: "Accept-Encoding",
			ETag: etag,
			"Last-Modified": new Date(Bun.file(cachePath).lastModified).toUTCString(),
			"Accept-Ranges": "bytes",
			Expires: new Date(Date.now() + 2592000).toUTCString(),
		},
	});
});

// Modified helper to check for oldcharacters fallback
async function loadOrProcessImage(
	id: string,
	cachePath: string,
	requestedSize: number | null,
	webpRequested: boolean,
): Promise<ArrayBuffer> {
	// First check if we have it in cache already
	if (await Bun.file(cachePath).exists()) {
		return await Bun.file(cachePath).arrayBuffer();
	}

	// If not in cache, fetch from EVE image server
	const url = `https://images.evetech.net/characters/${id}/portrait`;
	const res = await fetch(url);
	const eveETag = res.headers.get("ETag");
	const defaultETag = getDefaultCharacterETag();

	// Check if the returned image is the default (missing) character image
	if (eveETag === defaultETag) {
		// Try to get from oldcharacters
		const oldCharResult = await getOldCharacterImage(id, webpRequested);

		if (oldCharResult.found && oldCharResult.image) {
			// We found an old character image, process it if needed
			let processed = oldCharResult.image;
			if (requestedSize) {
				processed = await resizeImage(processed, requestedSize);
			}
			// Save to the character cache
			await Bun.file(cachePath).write(processed);
			return processed;
		}
	}

	// Either the image from EVE is not the default, or we couldn't find an old character image
	const original = await res.arrayBuffer();
	let processed = original;

	if (requestedSize) {
		processed = await resizeImage(processed, requestedSize);
	}
	if (webpRequested) {
		processed = await convertToWebp(processed);
	}

	await Bun.file(cachePath).write(processed);
	return processed;
}
