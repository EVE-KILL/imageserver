import { createHash } from 'crypto';

export function generateETag(buffer: ArrayBuffer): string {
	const hash = createHash('sha256');
	hash.update(Buffer.from(buffer));
	return 'W/"' + hash.digest('hex') + '"';
}

// New helper: generate ETag using file stats (mtime and size)
export async function generateETagForFile(filePath: string): Promise<string> {
	const stats = await Bun.file(filePath).stat();
	return `W/"${stats.mtimeMs}-${stats.size}"`;
}
