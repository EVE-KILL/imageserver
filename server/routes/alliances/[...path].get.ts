import { getCacheFilename } from "../../utils/cacheUtils";
import { generateETagForFile } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { convertToWebp } from "../../utils/convertToWebp";
import { resizeImage } from "../../utils/resizeImage";

export default defineEventHandler(async (event) => {
	const path = event.context.params.path;
	const [id, type] = path.split("/");
	// For alliances we use the /logo endpoint
	const params = getQuery(event) || {};
	const requestedSize = params.size ? Number.parseInt(params.size, 10) : null;
	delete params.size;

	// Check for forced image type
	const imageType = params.imagetype?.toLowerCase();
	delete params.imagetype;

	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;

	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	const desiredExt = webpRequested ? "webp" : "png";

	// Construct cache path. Include size if provided.
	const cachePath = requestedSize
		? `./cache/alliances/${id}-${requestedSize}.${desiredExt}`
		: getCacheFilename(id, params, desiredExt, "./cache/alliances");

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
			"Content-Type": webpRequested ? "image/webp" : "image/png",
			"Cache-Control": "public, max-age=2592000",
			Vary: "Accept-Encoding",
			ETag: etag,
			"Last-Modified": new Date(Bun.file(cachePath).lastModified).toUTCString(),
			"Accept-Ranges": "bytes",
			Expires: new Date(Date.now() + 2592000).toUTCString(),
		},
	});
});

// Helper: Always fetch full quality from the upstream URL (without any size parameter),
// then resize if requested and convert if needed.
async function loadOrProcessImage(
	id: string,
	cachePath: string,
	requestedSize: number | null,
	webpRequested: boolean,
): Promise<ArrayBuffer> {
	if (await Bun.file(cachePath).exists()) {
		return await Bun.file(cachePath).arrayBuffer();
	}
	// Upstream URL for alliances uses /logo and does not pass ?size.
	const url = `https://images.evetech.net/alliances/${id}/logo`;
	const res = await fetch(url);
	const original = await res.arrayBuffer();
	let processed = original;
	if (requestedSize) {
		processed = await resizeImage(original, requestedSize);
	}
	if (webpRequested) {
		processed = await convertToWebp(processed);
	}
	await Bun.file(cachePath).write(processed);
	return processed;
}
