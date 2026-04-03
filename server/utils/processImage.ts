import sharp from 'sharp';

// Limit libvips internal cache to prevent unbounded native memory growth
sharp.cache({ memory: 128, files: 20, items: 200 });
sharp.concurrency(1);

/**
 * Process an image in a single Sharp pipeline: resize + format convert.
 * Avoids creating multiple Sharp instances (and native memory allocations) per image.
 */
export async function processImage(
	buffer: ArrayBuffer,
	size: number | null,
	webp: boolean,
): Promise<ArrayBuffer> {
	// No processing needed
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

	const outputBuffer = await pipeline.toBuffer();
	return outputBuffer.buffer.slice(
		outputBuffer.byteOffset,
		outputBuffer.byteOffset + outputBuffer.byteLength
	) as ArrayBuffer;
}
