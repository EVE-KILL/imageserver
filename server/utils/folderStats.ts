import { promises as fs } from 'node:fs';
import path from 'node:path';

// Type definition for folder stats
interface FolderStats {
  sizeKB: number;
  fileCount: number;
}

// Store for pre-calculated stats
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

// Initialize with empty stats
for (const folder of folders) {
  cachedStats[folder] = { sizeKB: 0, fileCount: 0 };
}

async function getFolderStats(dir: string): Promise<FolderStats> {
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

// Function to calculate all folder stats
async function calculateAllFolderStats(): Promise<void> {
  // Prevent concurrent calculations
  if (isCalculating) return;

  try {
    isCalculating = true;
    console.log('Calculating folder statistics...');
    const newStats: Record<string, FolderStats> = {};

    for (const folder of folders) {
      const fullPath = path.resolve('./cache/' + folder);
      newStats[folder] = await getFolderStats(fullPath);
    }

    cachedStats = newStats;
    console.log('Folder statistics recalculated at:', new Date().toISOString());
  } catch (error) {
    console.error('Error calculating folder statistics:', error);
  } finally {
    isCalculating = false;
  }
}

// Get the current stats
export function getCurrentStats(): Record<string, FolderStats> {
  return { ...cachedStats };
}

// Initialize and set up recurring calculation
export function initFolderStats(): void {
  // Start initial calculation in the background
  calculateAllFolderStats().catch(err =>
    console.error('Error in initial folder stats calculation:', err)
  );

  // Recalculate every hour
  setInterval(() => {
    calculateAllFolderStats().catch(err =>
      console.error('Error in scheduled folder stats calculation:', err)
    );
  }, 60 * 60 * 1000);
}
