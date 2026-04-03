import { getHeader } from "h3";
import { generateETag, generateETagForFile } from "../../utils/hashUtils";
import { processImage } from "../../utils/processImage";
import { lruGet, lruSet, lruKey } from "../../utils/lruCache";

export default defineEventHandler(async (event) => {
	const path = event.context.params.path;
	const [id] = path.split("/");

	if (!id) {
		throw createError({ statusCode: 400, statusMessage: 'Character ID is missing' });
	}

	const params = getQuery(event) || {};
	const imageType = String(params.imagetype || '').toLowerCase();

	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;
	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	// Find the source JPG file
	const jpgPath = `./cache/oldcharacters/${id}_256.jpg`;
	const missingJpgPath = `./cache/oldcharacters/missing_256.jpg`;

	let imagePath: string;
	if (await Bun.file(jpgPath).exists()) {
		imagePath = jpgPath;
	} else if (await Bun.file(missingJpgPath).exists()) {
		imagePath = missingJpgPath;
	} else {
		throw createError({ statusCode: 404, statusMessage: 'Old character image not found' });
	}

	const desiredFormat = webpRequested ? "webp" : "jpg";

	// If no conversion needed, serve the JPG directly
	if (!webpRequested) {
		const image = await Bun.file(imagePath).arrayBuffer();
		const etag = await generateETagForFile(imagePath);
		const ifNoneMatch = getHeader(event, "if-none-match");
		if (ifNoneMatch === etag) {
			return new Response(null, { status: 304, headers: { ETag: etag } });
		}
		return new Response(image, {
			headers: {
				"Content-Type": "image/jpeg",
				"Cache-Control": "public, max-age=86400",
				Vary: "Accept-Encoding",
				ETag: etag,
				"Last-Modified": new Date(Bun.file(imagePath).lastModified).toUTCString(),
				"Accept-Ranges": "bytes",
				Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
			},
		});
	}

	// WebP requested — use LRU cache for converted version
	const cacheKey = lruKey(imagePath, null, "webp");
	const etag = await generateETag(imagePath, null, "webp");

	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch && ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	let image = lruGet(cacheKey);
	if (!image) {
		const original = await Bun.file(imagePath).arrayBuffer();
		image = await processImage(original, null, true);
		lruSet(cacheKey, image);
	}

	return new Response(image, {
		headers: {
			"Content-Type": "image/webp",
			"Cache-Control": "public, max-age=86400",
			Vary: "Accept-Encoding",
			ETag: etag,
			"Last-Modified": new Date(Bun.file(imagePath).lastModified).toUTCString(),
			"Accept-Ranges": "bytes",
			Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
		},
	});
});
