import { getHeader } from "h3";
import { generateETagForFile } from "../../utils/hashUtils";
import { convertToWebp } from "../../utils/convertToWebp";

export default defineEventHandler(async (event) => {
	// Parse path params
	const path = event.context.params.path;
	const [id] = path.split("/");

	if (!id) {
		return {
			statusCode: 400,
			body: {
				error: "Character ID is missing"
			}
		}
	}

	// Check for forced image type
	const params = getQuery(event) || {};
	const imageType = String(params.imagetype || '').toLowerCase();

	// Check for WebP support
	const acceptHeader = getHeader(event, "accept") || "";
	let webpRequested: boolean;

	if (imageType) {
		webpRequested = imageType === "webp";
	} else {
		webpRequested = acceptHeader.includes("image/webp");
	}

	// Define file paths
	const jpgPath = `./cache/oldcharacters/${id}_256.jpg`;
	const webpPath = `./cache/oldcharacters/${id}_256.webp`;
	const missingJpgPath = `./cache/oldcharacters/missing_256.jpg`;
	const missingWebpPath = `./cache/oldcharacters/missing_256.webp`;

	let imagePath: string;
	let needsConversion = false;

	// Determine which file to use
	if (webpRequested) {
		// Check for existing webp version first
		if (await Bun.file(webpPath).exists()) {
			imagePath = webpPath;
		}
		// Check for jpg version that can be converted
		else if (await Bun.file(jpgPath).exists()) {
			imagePath = jpgPath;
			needsConversion = true;
		}
		// Check for missing webp fallback
		else if (await Bun.file(missingWebpPath).exists()) {
			imagePath = missingWebpPath;
		}
		// Fall back to missing jpg that needs conversion
		else {
			imagePath = missingJpgPath;
			needsConversion = true;
		}
	} else {
		// For non-webp requests, use jpg directly
		if (await Bun.file(jpgPath).exists()) {
			imagePath = jpgPath;
		} else {
			imagePath = missingJpgPath;
		}
	}

	// Load the image
	let image = await Bun.file(imagePath).arrayBuffer();

	// Convert to webp if needed
	if (needsConversion && webpRequested) {
		image = await convertToWebp(image);

		// Save the converted webp for future use
		const savePath = imagePath === jpgPath ? webpPath : missingWebpPath;
		await Bun.file(savePath).write(image);
	}

	// Generate ETag
	const etag = await generateETagForFile(imagePath);

	// Handle 304 Not Modified
	const ifNoneMatch = getHeader(event, "if-none-match");
	if (ifNoneMatch === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}

	// Return the image
	return new Response(image, {
		headers: {
			"Content-Type": webpRequested && (needsConversion || imagePath.endsWith('.webp'))
				? "image/webp"
				: "image/jpeg",
			"Cache-Control": "public, max-age=86400",
			"Vary": "Accept-Encoding",
			"ETag": etag,
			"Last-Modified": new Date(Bun.file(imagePath).lastModified).toUTCString(),
			"Accept-Ranges": "bytes",
			"Expires": new Date(Date.now() + 86400 * 1000).toUTCString(),
		},
	});
});
