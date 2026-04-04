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
	// Resize the base image first, then composite the overlay at 10% of output size.
	// This ensures the overlay scales proportionally: 512→51px, 256→26px, 128→13px, 64→6px
	const basePipeline = sharp(buffer);
	const metadata = await basePipeline.metadata();
	const baseWidth = metadata.width || 512;
	const outputWidth = size || baseWidth;
	const targetOverlaySize = Math.max(4, Math.floor(outputWidth / 5));

	// Resize overlay to target
	const overlayBuffer = await Bun.file(overlayPath).arrayBuffer();
	const resizedOverlay = await sharp(overlayBuffer)
		.resize(targetOverlaySize, targetOverlaySize, {
			kernel: sharp.kernel.lanczos3,
			fit: 'fill',
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();

	// Resize base first, then composite overlay, then format convert
	let pipeline = sharp(buffer);

	if (size && baseWidth > size) {
		pipeline = pipeline.resize(size, size, { fit: 'inside' });
	}

	pipeline = pipeline.composite([{ input: resizedOverlay, top: 0, left: 0 }]);

	if (webp) {
		pipeline = pipeline.toFormat('webp');
	}

	const output = await pipeline.toBuffer();
	return output.buffer as ArrayBuffer;
}
