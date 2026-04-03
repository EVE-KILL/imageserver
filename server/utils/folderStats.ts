import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getStats as getDbStats } from './metadataDb';

interface FolderStats {
  sizeKB: number;
  fileCount: number;
}

// Folders tracked via SQLite metadata (upstream-proxied + types)
const dbFolders = ['characters', 'corporations', 'alliances', 'types'];

// Folders that need filesystem walking (local source data, no DB entries)
const walkFolders = ['oldcharacters'];

// Walk results are cached since they're expensive (recalculated periodically)
let walkCache: Record<string, FolderStats> = {};
for (const folder of walkFolders) {
  walkCache[folder] = { sizeKB: 0, fileCount: 0 };
}
let isCalculating = false;

async function getFolderStatsByWalk(dir: string): Promise<FolderStats> {
  let totalSize = 0;
  let totalCount = 0;

  async function walk(currentDir: string) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
        totalCount++;
      }
    }
  }

  await walk(dir);

  return {
    sizeKB: Math.round(totalSize / 1024),
    fileCount: totalCount,
  };
}

async function calculateWalkStats(): Promise<void> {
  if (isCalculating) return;

  try {
    isCalculating = true;
    console.log('Calculating folder statistics...');

    const results = await Promise.all(
      walkFolders.map(async (folder) => {
        const fullPath = path.resolve('./cache/' + folder);
        const stats = await getFolderStatsByWalk(fullPath);
        return [folder, stats] as const;
      })
    );

    for (const [folder, stats] of results) {
      walkCache[folder] = stats;
    }

    console.log('Folder statistics recalculated at:', new Date().toISOString());
  } catch (error) {
    console.error('Error calculating folder statistics:', error);
  } finally {
    isCalculating = false;
  }
}

/**
 * Get current stats — DB folders are always live, walk folders are cached.
 */
export function getCurrentStats(): Record<string, FolderStats> {
  const result: Record<string, FolderStats> = {};

  // DB-tracked folders: always fresh from SQLite (instant query)
  const dbStats = getDbStats();
  for (const folder of dbFolders) {
    const stats = dbStats[folder];
    result[folder] = stats
      ? { sizeKB: stats.totalSizeKB, fileCount: stats.fileCount }
      : { sizeKB: 0, fileCount: 0 };
  }

  // Walk-based folders: use cached values
  for (const folder of walkFolders) {
    result[folder] = walkCache[folder];
  }

  return result;
}

export function initFolderStats(): void {
  // Calculate walk-based stats immediately at startup
  calculateWalkStats().catch(err =>
    console.error('Error in initial folder stats calculation:', err)
  );

  // Recalculate walk-based stats every hour
  setInterval(() => {
    calculateWalkStats().catch(err =>
      console.error('Error in scheduled folder stats calculation:', err)
    );
  }, 60 * 60 * 1000);
}
