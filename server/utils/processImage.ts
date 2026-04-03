import sharp from 'sharp';

// Limit libvips internal cache to prevent unbounded native memory growth
sharp.cache({ memory: 128, files: 20, items: 200 });
sharp.concurrency(2);

/**
 * Process an image in a single Sharp pipeline: resize + format convert.
 * One decode, one encode, one set of native buffers.
 */
export async function processImage(
	buffer: ArrayBuffer,
	size: number | null,
	webp: boolean,
): Promise<ArrayBuffer> {
	if (!size && !webp) return buffer;

	let pipeline = sharp(buffer);

	if (size) {
		const metadata = await pipeline.metadata();
		const width = metadata.width || size;
		if (width > size) {
			pipeline = pipeline.resize(size, size, { fit: 'inside' });
		}
	}

	if (webp) {
		pipeline = pipeline.toFormat('webp');
	}

	const output = await pipeline.toBuffer();
	return output.buffer as ArrayBuffer;
}

/**
 * Process an image with an overlay composited on top, then resize + format convert.
 * Single Sharp pipeline for the final output — overlay is pre-resized separately.
 */
export async function processImageWithOverlay(
	buffer: ArrayBuffer,
	overlayPath: string,
	size: number | null,
	webp: boolean,
): Promise<ArrayBuffer> {
	// Get base image dimensions for overlay scaling
	const basePipeline = sharp(buffer);
	const metadata = await basePipeline.metadata();
	const baseWidth = metadata.width || 64;
	const targetOverlaySize = Math.max(16, Math.floor(baseWidth / 4));

	// Resize overlay (separate pipeline — necessary since composite needs a buffer)
	const overlayBuffer = await Bun.file(overlayPath).arrayBuffer();
	const resizedOverlay = await sharp(overlayBuffer)
		.resize(targetOverlaySize, targetOverlaySize, {
			kernel: sharp.kernel.lanczos3,
			fit: 'fill',
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();

	// Single pipeline: composite overlay + resize + format convert
	let pipeline = sharp(buffer)
		.composite([{ input: resizedOverlay, top: 0, left: 0 }]);

	if (size) {
		if (baseWidth > size) {
			pipeline = pipeline.resize(size, size, { fit: 'inside' });
		}
	}

	if (webp) {
		pipeline = pipeline.toFormat('webp');
	}

	const output = await pipeline.toBuffer();
	return output.buffer as ArrayBuffer;
}
