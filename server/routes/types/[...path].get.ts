import { getHeader, getQuery } from "h3";
import { generateETagForFile } from "../../utils/hashUtils";
import { convertToWebp } from "../../utils/convertToWebp";
import { resizeImage } from "../../utils/resizeImage";
import { applyOverlay } from "../../utils/overlayImage";

// Lazy-loaded data - will be loaded on first request
let serviceMetadata: any = null;
let idToOverlayMap: Map<number, string> | null = null;

// Function to load data if not already loaded
async function loadData() {
	if (!serviceMetadata) {
		serviceMetadata = await Bun.file("./images/service_metadata.json").json();
	}

	if (!idToOverlayMap) {
		const overlayIds = await Bun.file("./overlays/ids.json").json();
		idToOverlayMap = new Map<number, string>();

		// Create reverse lookup map: ID -> overlay type
		for (const [overlayType, ids] of Object.entries(overlayIds)) {
			for (const id of ids as number[]) {
				idToOverlayMap.set(id, overlayType);
			}
		}
	}
}

export default defineEventHandler(async (event) => {
	// Load data on first request
	await loadData();

	// Parse path params
	const path = event.context.params.path;
	const [id, type] = path.split("/");

	// Determine source: local if serviceMetadata[id] exists and has a value for [type]
	const data = serviceMetadata[id] || {};
	const localEntry = data[type];

    if (Object.keys(data).length === 0) {
        return {
            statusCode: 400,
            body: {
                error: "Data for this ID is missing"
            }
        }
    }

	if (!type) {
        const availableTypes = Object.keys(data);
        return {
            statusCode: 400,
            body: {
                error: "Type is missing",
                availableTypes: availableTypes
            }
        }
    }

	// Retrieve query parameters and check for size and WebP support
	const query = getQuery(event) || {};
	const validSizes = [8, 16, 32, 64, 128, 256, 512, 1024];
	const sizeParam = Number.parseInt(query.size, 10);
	const requestedSize = validSizes.includes(sizeParam) ? sizeParam : null;

	// Check for forced image type
	const imageType = String(query.imagetype || '').toLowerCase();
	delete query.imagetype;

	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;

	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	// Set base extension based on source: local images are PNG, upstream images are JPEG
	const baseExt = localEntry ? "png" : "jpeg";
	const desiredExt = webpRequested ? "webp" : baseExt;

	// Construct cache path. Include size if applicable.
	let cachePath = "";
	// For overlayrender type, include overlay in cache path since it might have an overlay applied
	const needsOverlay = type === "overlayrender";
	const overlayType = needsOverlay ? idToOverlayMap.get(Number.parseInt(id, 10)) : null;
	const cacheTypeSuffix = needsOverlay && overlayType ? `${type}-${overlayType}` : type;

	if (requestedSize) {
		cachePath = `./cache/types/${id}-${cacheTypeSuffix}-${requestedSize}.${desiredExt}`;
	} else {
		cachePath = `./cache/types/${id}-${cacheTypeSuffix}.${desiredExt}`;
	}

	let image: ArrayBuffer;
	let etag: string;

	if (localEntry) {
		const fullImagePath = `./images/${localEntry}`;
		// If no conversion is requested AND no overlay is needed, serve the original file directly.
		if (!requestedSize && !webpRequested && !overlayType) {
			cachePath = fullImagePath;
		}
		image = await loadOrProcessImage(
			fullImagePath,
			cachePath,
			requestedSize,
			webpRequested,
			false,
			overlayType,
		);
		etag = await generateETagForFile(cachePath);
	} else {
		// Not in the local dump: fetch from upstream
		// Build upstream URL with any query parameters (except "size" because we handle resizing locally)
		const upstreamQuery = { ...query };
		delete upstreamQuery.size;
		const qs =
			Object.keys(upstreamQuery).length > 0
				? "?" + new URLSearchParams(upstreamQuery)
				: "";
		// Use "render" for upstream when type is "overlayrender"
		const upstreamType = type === "overlayrender" ? "render" : type;
		const upstreamURL = `https://images.evetech.net/types/${id}/${upstreamType}${qs}`;
		image = await loadOrProcessImage(
			upstreamURL,
			cachePath,
			requestedSize,
			webpRequested,
			true,
			overlayType,
		);
		etag = await generateETagForFile(cachePath);
	}

	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	return new Response(image, {
		headers: {
			"Content-Type": webpRequested
				? "image/webp"
				: baseExt === "png"
					? "image/png"
					: "image/jpeg",
			"Cache-Control": "public, max-age=86400",
			Vary: "Accept-Encoding",
			ETag: etag,
			"Last-Modified": new Date(
				Bun.file(localEntry ? `./images/${localEntry}` : cachePath)
					.lastModified,
			).toUTCString(),
			"Accept-Ranges": "bytes",
			Expires: new Date(Date.now() + 86400 * 1000).toUTCString(),
		},
	});
});

// Helper: load or process image from a source (file path or URL)
// If upstream is true, fetch the image from the URL; otherwise, load the local file.
async function loadOrProcessImage(
	source: string,
	cachePath: string,
	requestedSize: number | null,
	webpRequested: boolean,
	upstream = false,
	overlayType: string | null = null,
): Promise<ArrayBuffer> {
	// If cached file exists, just load it.
	if (await Bun.file(cachePath).exists()) {
		return await Bun.file(cachePath).arrayBuffer();
	}
	let original: ArrayBuffer;
	if (upstream) {
		const res = await fetch(source);
		original = await res.arrayBuffer();
	} else {
		original = await Bun.file(source).arrayBuffer();
	}
	let processed = original;

	// Apply overlay first if needed (before resizing to maintain quality)
	if (overlayType !== null) {
		processed = await applyOverlay(processed, overlayType);
	}

	if (requestedSize) {
		processed = await resizeImage(processed, requestedSize);
	}
	if (webpRequested) {
		processed = await convertToWebp(processed);
	}
	// Save processed version into cache.
	await Bun.file(cachePath).write(processed);
	return processed;
}
