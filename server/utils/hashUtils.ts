export async function generateETagForFile(filePath: string): Promise<string> {
	const stats = await Bun.file(filePath).stat();
	return `W/"${stats.mtimeMs}-${stats.size}"`;
}
