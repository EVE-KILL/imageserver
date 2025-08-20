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

import { getCurrentStats } from '../utils/folderStats';
import { cacheValidator } from '../utils/cacheValidator';

export default defineEventHandler(async () => {
  const folderStats = getCurrentStats();
  const cacheValidationStats = cacheValidator.getStats();

  return {
    folderStats,
    cacheValidation: {
      ...cacheValidationStats,
      lastValidationRun: cacheValidationStats.lastValidationRun
        ? new Date(cacheValidationStats.lastValidationRun).toISOString()
        : null,
      nextValidationEstimate: cacheValidationStats.lastValidationRun
        ? new Date(cacheValidationStats.lastValidationRun + 6 * 60 * 60 * 1000).toISOString() // +6 hours
        : null,
      averageValidationDurationMs: Math.round(cacheValidationStats.averageValidationDuration)
    }
  };
});
