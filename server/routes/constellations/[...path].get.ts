import { generateETagForFile } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { convertToWebp } from "../../utils/convertToWebp";
import { resizeImage } from "../../utils/resizeImage";

export default defineEventHandler(async (event) => {
	const path = event.context.params.path;
	const [id] = path.split("/");

	if (!id) {
		return {
			statusCode: 400,
			body: {
				error: "Constellation ID is missing"
			}
		}
	}

	// Parse query parameters
	const params = getQuery(event) || {};
	const sizeParam = params.size ? Number.parseInt(String(params.size), 10) : null;

	// Validate size parameter - limit to 32, 64, 128 and find closest
	let requestedSize: number | null = null;
	if (sizeParam) {
		const validSizes = [32, 64, 128];
		if (validSizes.includes(sizeParam)) {
			requestedSize = sizeParam;
		} else {
			// Find closest size
			const closest = validSizes.reduce((prev, curr) => {
				return Math.abs(curr - sizeParam) < Math.abs(prev - sizeParam) ? curr : prev;
			});
			requestedSize = closest;
		}
	}

	// Check for forced image type
	const imageType = String(params.imagetype || '').toLowerCase();

	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;

	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	const image = await loadOrProcessImage(
		id,
		requestedSize,
		webpRequested,
	);

	if (!image) {
		return {
			statusCode: 404,
			body: {
				error: "Constellation image not found"
			}
		}
	}

	const desiredExt = webpRequested ? "webp" : "png";
	const cachePath = requestedSize
		? `./cache/constellations/${id}-${requestedSize}.${desiredExt}`
		: `./cache/constellations/${id}.${desiredExt}`;

	const etag = await generateETagForFile(cachePath);
	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	return new Response(image, {
		headers: {
			"Content-Type": webpRequested ? "image/webp" : "image/png",
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
	requestedSize: number | null,
	webpRequested: boolean,
): Promise<ArrayBuffer | null> {
	const desiredExt = webpRequested ? "webp" : "png";
	const cachePath = requestedSize
		? `./cache/constellations/${id}-${requestedSize}.${desiredExt}`
		: `./cache/constellations/${id}.${desiredExt}`;

	// Check if we have it in cache already
	if (await Bun.file(cachePath).exists()) {
		return await Bun.file(cachePath).arrayBuffer();
	}

	// Determine which source image to use based on requested size
	let sourceImagePath: string;
	if (requestedSize === 32) {
		// Use 32px version if it exists, otherwise use main image
		const smallImagePath = `./constellations/${id}_32.png`;
		if (await Bun.file(smallImagePath).exists()) {
			sourceImagePath = smallImagePath;
		} else {
			const mainImagePath = `./constellations/${id}.png`;
			if (await Bun.file(mainImagePath).exists()) {
				sourceImagePath = mainImagePath;
			} else {
				return null;
			}
		}
	} else {
		// Use main image for 64px and 128px (and no size)
		const mainImagePath = `./constellations/${id}.png`;
		if (await Bun.file(mainImagePath).exists()) {
			sourceImagePath = mainImagePath;
		} else {
			return null;
		}
	}

	// Load the source image
	let processed = await Bun.file(sourceImagePath).arrayBuffer();

	// Resize if needed (only for 64px and 128px, since 32px uses pre-sized image)
	if (requestedSize && requestedSize !== 32) {
		processed = await resizeImage(processed, requestedSize);
	}

	// Convert to WebP if requested
	if (webpRequested) {
		processed = await convertToWebp(processed);
	}

	// Save to cache
	await Bun.file(cachePath).write(processed);

	return processed;
}
