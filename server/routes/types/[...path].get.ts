import { getHeader, getQuery } from "h3";
import { generateETag } from "../../utils/hashUtils";
import { getShardedPath, ensureShardDir } from "../../utils/cacheUtils";
import { processImage, processImageWithOverlay } from "../../utils/processImage";
import { lruGet, lruSet, lruKey } from "../../utils/lruCache";

// Lazy-loaded data
let serviceMetadata: any = null;
let idToOverlayMap: Map<number, string> | null = null;

async function loadData() {
	if (!serviceMetadata) {
		serviceMetadata = await Bun.file("./images/service_metadata.json").json();
	}
	if (!idToOverlayMap) {
		const overlayIds = await Bun.file("./overlays/ids.json").json();
		idToOverlayMap = new Map<number, string>();
		for (const [overlayType, ids] of Object.entries(overlayIds)) {
			for (const id of ids as number[]) {
				idToOverlayMap.set(id, overlayType);
			}
		}
	}
}

export default defineEventHandler(async (event) => {
	await loadData();

	const path = event.context.params.path;
	const [id, type] = path.split("/");

	const data = serviceMetadata[id] || {};
	const localEntry = data[type];

	if (Object.keys(data).length === 0) {
		throw createError({ statusCode: 400, statusMessage: 'Data for this ID is missing' });
	}

	if (!type) {
		throw createError({ statusCode: 400, statusMessage: `Type is missing. Available types: ${Object.keys(data).join(', ')}` });
	}

	const query = getQuery(event) || {};
	const validSizes = [8, 16, 32, 64, 128, 256, 512, 1024];
	const sizeParam = Number.parseInt(String(query.size), 10);
	const requestedSize = validSizes.includes(sizeParam) ? sizeParam : null;

	const imageType = String(query.imagetype || '').toLowerCase();

	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;
	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	const baseExt = localEntry ? "png" : "jpeg";
	const desiredFormat = webpRequested ? "webp" : baseExt;

	const needsOverlay = type === "overlayrender";
	const overlayType = needsOverlay ? idToOverlayMap!.get(Number.parseInt(id, 10)) : null;

	// Cache path for the base image (overlay applied on-the-fly per size)
	const cacheSuffix = overlayType ? `${type}-base` : type;
	const cachePath = getShardedPath("types", id, `${cacheSuffix}.original`);

	const cacheKey = lruKey(cachePath, requestedSize, desiredFormat);

	// Check LRU first
	let processed = lruGet(cacheKey);

	if (!processed) {
		if (localEntry) {
			const fullImagePath = `./images/${localEntry}`;

			// If no processing needed at all, serve original directly
			if (!requestedSize && !webpRequested && !overlayType) {
				const image = await Bun.file(fullImagePath).arrayBuffer();
				const etag = await generateETag(fullImagePath, null, baseExt);
				const ifNoneMatch = getHeader(event, "if-none-match");
				if (ifNoneMatch && ifNoneMatch === etag) {
					return new Response(null, { status: 304, headers: { ETag: etag } });
				}
				return new Response(image, {
					headers: makeHeaders(fullImagePath, etag, desiredFormat, baseExt),
				});
			}

			processed = await loadOrProcessLocal(fullImagePath, cachePath, requestedSize, webpRequested, overlayType);
		} else {
			const upstreamQuery = { ...query };
			delete upstreamQuery.size;
			delete upstreamQuery.imagetype;
			const upstreamParams: Record<string, string> = {};
			for (const [k, v] of Object.entries(upstreamQuery)) {
				if (v != null) upstreamParams[k] = String(v);
			}
			const qs = Object.keys(upstreamParams).length > 0
				? "?" + new URLSearchParams(upstreamParams)
				: "";
			const upstreamType = type === "overlayrender" ? "render" : type;
			const upstreamURL = `https://images.evetech.net/types/${id}/${upstreamType}${qs}`;

			processed = await loadOrProcessUpstream(upstreamURL, cachePath, requestedSize, webpRequested, overlayType);
		}
		lruSet(cacheKey, processed);
	}

	const sourceForEtag = await Bun.file(cachePath).exists() ? cachePath : `./images/${localEntry}`;
	const etag = await generateETag(sourceForEtag, requestedSize, desiredFormat);

	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch && ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	return new Response(processed, {
		headers: makeHeaders(sourceForEtag, etag, desiredFormat, baseExt),
	});
});

function makeHeaders(filePath: string, etag: string, desiredFormat: string, baseExt: string): Record<string, string> {
	const contentType = desiredFormat === "webp" ? "image/webp"
		: baseExt === "png" ? "image/png"
		: "image/jpeg";

	return {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=86400",
		Vary: "Accept-Encoding",
		ETag: etag,
		"Last-Modified": new Date(Bun.file(filePath).lastModified).toUTCString(),
		"Accept-Ranges": "bytes",
		Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
	};
}

async function loadOrProcessLocal(
	sourcePath: string,
	cachePath: string,
	requestedSize: number | null,
	webpRequested: boolean,
	overlayType: string | null,
): Promise<ArrayBuffer> {
	const base = await Bun.file(sourcePath).arrayBuffer();

	if (overlayType) {
		const overlayPath = `./overlays/${overlayType}.png`;
		return processImageWithOverlay(base, overlayPath, requestedSize, webpRequested);
	}

	return processImage(base, requestedSize, webpRequested);
}

async function loadOrProcessUpstream(
	upstreamURL: string,
	cachePath: string,
	requestedSize: number | null,
	webpRequested: boolean,
	overlayType: string | null,
): Promise<ArrayBuffer> {
	// Cache the raw base render on disk (without overlay)
	let base: ArrayBuffer;
	if (await Bun.file(cachePath).exists()) {
		base = await Bun.file(cachePath).arrayBuffer();
	} else {
		const res = await fetch(upstreamURL);
		if (!res.ok) {
			throw createError({ statusCode: res.status, statusMessage: `Upstream returned ${res.status}` });
		}
		base = await res.arrayBuffer();
		await ensureShardDir(cachePath);
		await Bun.file(cachePath).write(base);
	}

	if (overlayType) {
		const overlayPath = `./overlays/${overlayType}.png`;
		return processImageWithOverlay(base, overlayPath, requestedSize, webpRequested);
	}

	return processImage(base, requestedSize, webpRequested);
}
