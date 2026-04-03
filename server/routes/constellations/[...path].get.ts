import { generateETag } from "../../utils/hashUtils";
import { getHeader, getQuery } from "h3";
import { processImage } from "../../utils/processImage";
import { lruGet, lruSet, lruKey } from "../../utils/lruCache";

export default defineEventHandler(async (event) => {
	const path = event.context.params.path;
	const [id] = path.split("/");

	if (!id) {
		throw createError({ statusCode: 400, statusMessage: 'Constellation ID is missing' });
	}

	const params = getQuery(event) || {};
	const sizeParam = params.size ? Number.parseInt(String(params.size), 10) : null;

	let requestedSize: number | null = null;
	if (sizeParam) {
		const validSizes = [32, 64, 128];
		if (validSizes.includes(sizeParam)) {
			requestedSize = sizeParam;
		} else {
			requestedSize = validSizes.reduce((prev, curr) =>
				Math.abs(curr - sizeParam) < Math.abs(prev - sizeParam) ? curr : prev
			);
		}
	}

	const imageType = String(params.imagetype || '').toLowerCase();
	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;
	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	const desiredFormat = webpRequested ? "webp" : "png";

	const sourcePath = await findSourceImage("constellations", id, requestedSize);
	if (!sourcePath) {
		throw createError({ statusCode: 404, statusMessage: 'Constellation image not found' });
	}

	const needsResize = requestedSize !== null && !sourcePath.endsWith(`_32.png`);
	const needsProcessing = needsResize || webpRequested;

	if (!needsProcessing) {
		const etag = await generateETag(sourcePath, null, "png");
		const ifNoneMatch = getHeader(event, "if-none-match");
		if (ifNoneMatch && ifNoneMatch === etag) {
			return new Response(null, { status: 304, headers: { ETag: etag } });
		}
		const image = await Bun.file(sourcePath).arrayBuffer();
		return new Response(image, {
			headers: makeHeaders(sourcePath, etag, "png"),
		});
	}

	const cacheKey = lruKey(sourcePath, requestedSize, desiredFormat);
	let processed = lruGet(cacheKey);
	if (!processed) {
		const image = await Bun.file(sourcePath).arrayBuffer();
		processed = await processImage(image, needsResize ? requestedSize : null, webpRequested);
		lruSet(cacheKey, processed);
	}

	const etag = await generateETag(sourcePath, requestedSize, desiredFormat);
	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch && ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	return new Response(processed, {
		headers: makeHeaders(sourcePath, etag, desiredFormat),
	});
});

async function findSourceImage(category: string, id: string, requestedSize: number | null): Promise<string | null> {
	if (requestedSize === 32) {
		const smallPath = `./${category}/${id}_32.png`;
		if (await Bun.file(smallPath).exists()) return smallPath;
	}
	const mainPath = `./${category}/${id}.png`;
	if (await Bun.file(mainPath).exists()) return mainPath;
	return null;
}

function makeHeaders(sourcePath: string, etag: string, format: string): Record<string, string> {
	return {
		"Content-Type": format === "webp" ? "image/webp" : "image/png",
		"Cache-Control": "public, max-age=86400",
		Vary: "Accept-Encoding",
		ETag: etag,
		"Last-Modified": new Date(Bun.file(sourcePath).lastModified).toUTCString(),
		"Accept-Ranges": "bytes",
		Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
	};
}
