/**
 * Generate a weak ETag for a processed image variant.
 * Includes file metadata + request params so different size/format combos get unique ETags.
 */
export async function generateETag(filePath: string, size: number | null, format: string): Promise<string> {
	const file = Bun.file(filePath);
	const mtime = file.lastModified;
	const fileSize = file.size;
	return `W/"${mtime}-${fileSize}-${size ?? 'full'}-${format}"`;
}

/**
 * Legacy ETag generation from file metadata only.
 * Used for routes where the file on disk IS the final output (e.g. oldcharacters JPEGs served as-is).
 */
export async function generateETagForFile(filePath: string): Promise<string> {
	const file = Bun.file(filePath);
	return `W/"${file.lastModified}-${file.size}"`;
}
