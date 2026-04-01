import { promises as fs } from 'node:fs';
import path from 'node:path';

const METADATA_SUFFIX = '.meta.json';

interface FolderStats {
  sizeKB: number;
  fileCount: number;
  metadataSizeKB: number;
  metadataFileCount: number;
}

let cachedStats: Record<string, FolderStats> = {};
let isCalculating = false;
const folders = [
  'characters',
  'oldcharacters',
  'corporations',
  'alliances',
  'types',
  'systems',
  'regions',
  'constellations',
];

for (const folder of folders) {
  cachedStats[folder] = { sizeKB: 0, fileCount: 0, metadataSizeKB: 0, metadataFileCount: 0 };
}

async function getFolderStats(dir: string): Promise<FolderStats> {
  let imageSize = 0;
  let imageCount = 0;
  let metadataSize = 0;
  let metadataCount = 0;

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
        if (entry.name.endsWith(METADATA_SUFFIX)) {
          metadataSize += stats.size;
          metadataCount++;
        } else {
          imageSize += stats.size;
          imageCount++;
        }
      }
    }
  }

  await walk(dir);

  return {
    sizeKB: Math.round(imageSize / 1024),
    fileCount: imageCount,
    metadataSizeKB: Math.round(metadataSize / 1024),
    metadataFileCount: metadataCount,
  };
}

async function calculateAllFolderStats(): Promise<void> {
  if (isCalculating) return;

  try {
    isCalculating = true;
    console.log('Calculating folder statistics...');

    const results = await Promise.all(
      folders.map(async (folder) => {
        const fullPath = path.resolve('./cache/' + folder);
        const stats = await getFolderStats(fullPath);
        return [folder, stats] as const;
      })
    );

    const newStats: Record<string, FolderStats> = {};
    for (const [folder, stats] of results) {
      newStats[folder] = stats;
    }

    cachedStats = newStats;
    console.log('Folder statistics recalculated at:', new Date().toISOString());
  } catch (error) {
    console.error('Error calculating folder statistics:', error);
  } finally {
    isCalculating = false;
  }
}

export function getCurrentStats(): Record<string, FolderStats> {
  return { ...cachedStats };
}

export function initFolderStats(): void {
  calculateAllFolderStats().catch(err =>
    console.error('Error in initial folder stats calculation:', err)
  );

  setInterval(() => {
    calculateAllFolderStats().catch(err =>
      console.error('Error in scheduled folder stats calculation:', err)
    );
  }, 60 * 60 * 1000);
}
