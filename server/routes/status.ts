import { promises as fs } from 'node:fs';
import path from 'node:path';

async function getFolderStats(dir: string): Promise<{ sizeKB: number; fileCount: number }> {
	// Initialize accumulator variables
	let size = 0;
	let fileCount = 0;

	// Helper recursive function
	async function walk(currentDir: string) {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile()) {
				const stats = await fs.stat(fullPath);
				size += stats.size;
				fileCount += 1;
			}
		}
	}

	try {
		await walk(dir);
	} catch (err) {
		// In case the folder doesn't exist or another error occurs, keep default values
	}

	return { sizeKB: Math.round(size / 1024), fileCount };
}

export default defineEventHandler(async () => {
	const folders = [
		'characters',
		'oldcharacters',
		'corporations',
		'alliances',
		'types',
	];

	const status: Record<string, { sizeKB: number; fileCount: number }> = {};
	// Calculate status for each folder
	for (const folder of folders) {
		const fullPath = path.resolve('./cache/' + folder);
		status[folder] = await getFolderStats(fullPath);
	}

	return status;
});
