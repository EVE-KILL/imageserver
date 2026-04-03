import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  saveMetadata,
  loadMetadata,
  deleteMetadata,
  findByPrefix,
  getExpiredEntries,
  getStaleEntries,
  updateValidation,
  needsValidation as dbNeedsValidation,
} from './metadataDb';

interface CacheValidationStats {
  lastValidationRun: number | null;
  totalValidationRuns: number;
  totalImagesValidated: number;
  totalImagesRemoved: number;
  lastValidationDuration: number | null;
  averageValidationDuration: number;
  validationErrors: number;
  lastEvictionRun: number | null;
  totalEvicted: number;
}

const EVICTION_MAX_AGE_DAYS = 30;
const EVICTION_BATCH_SIZE = 1000;

export class CacheValidator {
  private validationTimer: NodeJS.Timeout | null = null;
  private stats: CacheValidationStats = {
    lastValidationRun: null,
    totalValidationRuns: 0,
    totalImagesValidated: 0,
    totalImagesRemoved: 0,
    lastValidationDuration: null,
    averageValidationDuration: 0,
    validationErrors: 0,
    lastEvictionRun: null,
    totalEvicted: 0,
  };

  start() {
    console.log('Starting background cache validator (6h intervals)');

    // Run initial validation after 5 minutes
    setTimeout(() => {
      this.runMaintenanceCycle().catch(err =>
        console.error('Error in initial cache maintenance:', err)
      );
    }, 5 * 60 * 1000);

    // Then run every 6 hours
    this.validationTimer = setInterval(() => {
      this.runMaintenanceCycle().catch(err =>
        console.error('Error in scheduled cache maintenance:', err)
      );
    }, 6 * 60 * 60 * 1000);
  }

  stop() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
  }

  getStats(): CacheValidationStats {
    return { ...this.stats };
  }

  /**
   * Run both validation and eviction
   */
  private async runMaintenanceCycle() {
    await this.validateExpiredEntries();
    await this.evictStaleEntries();
  }

  /**
   * Validate cached images whose cache_expiry has passed by checking upstream ETags
   */
  private async validateExpiredEntries() {
    console.log('Starting cache validation sweep...');
    const startTime = Date.now();
    let validatedCount = 0;
    let removedCount = 0;
    let errorCount = 0;

    // Query DB for expired entries instead of walking directories
    const expiredPaths = getExpiredEntries(5000);

    for (const cachePath of expiredPaths) {
      const fullPath = `./cache/${cachePath}`;
      const result = await this.validateSingleImage(fullPath, cachePath);
      if (result.action === 'validated') {
        validatedCount++;
      } else if (result.action === 'removed') {
        removedCount += result.removedCount;
      } else if (result.action === 'error') {
        errorCount++;
      }
    }

    const duration = Date.now() - startTime;

    this.stats.lastValidationRun = startTime;
    this.stats.totalValidationRuns++;
    this.stats.totalImagesValidated += validatedCount;
    this.stats.totalImagesRemoved += removedCount;
    this.stats.lastValidationDuration = duration;
    this.stats.validationErrors += errorCount;

    if (this.stats.totalValidationRuns === 1) {
      this.stats.averageValidationDuration = duration;
    } else {
      this.stats.averageValidationDuration =
        (this.stats.averageValidationDuration * (this.stats.totalValidationRuns - 1) + duration) /
        this.stats.totalValidationRuns;
    }

    console.log(`Cache validation completed in ${duration}ms. Validated: ${validatedCount}, Removed: ${removedCount}, Errors: ${errorCount}`);
  }

  /**
   * Validate a single cached image against upstream
   */
  private async validateSingleImage(fullPath: string, dbPath: string): Promise<{ action: 'validated' | 'error' } | { action: 'removed'; removedCount: number }> {
    try {
      const upstreamUrl = this.getUpstreamUrl(dbPath);
      if (!upstreamUrl) {
        return { action: 'error' };
      }

      const response = await fetch(upstreamUrl, { method: 'HEAD' });
      const currentETag = response.headers.get('etag');

      if (!currentETag) {
        // No ETag from upstream, just refresh the expiry
        updateValidation(fullPath, 'no-etag');
        return { action: 'validated' };
      }

      const meta = loadMetadata(fullPath);

      if (!meta) {
        // No metadata yet, create it
        try {
          const stat = await fs.stat(fullPath);
          saveMetadata(fullPath, currentETag, stat.size);
        } catch {
          saveMetadata(fullPath, currentETag, 0);
        }
        return { action: 'validated' };
      }

      if (currentETag !== meta.etag) {
        // ETag changed — image was updated upstream, remove cached version
        const removedCount = await this.removeCachedImage(fullPath, dbPath);
        console.log(`Removed ${removedCount} stale cached file(s) for: ${dbPath}`);
        return { action: 'removed', removedCount };
      }

      // ETag matches, refresh expiry
      updateValidation(fullPath, currentETag);
      return { action: 'validated' };
    } catch (error) {
      console.error(`Error validating ${dbPath}:`, error);
      return { action: 'error' };
    }
  }

  /**
   * Remove a cached image and its DB entry.
   * With single-size caching there's only one file per ID, but we also clean up
   * any leftover legacy size variants.
   */
  private async removeCachedImage(fullPath: string, dbPath: string): Promise<number> {
    // Extract the ID and directory from the path
    const dir = path.dirname(fullPath);
    const filename = path.basename(fullPath);
    const match = filename.match(/^(\d+)\./);

    if (!match) {
      try { await fs.unlink(fullPath); } catch {}
      deleteMetadata(fullPath);
      return 1;
    }

    const id = match[1];
    let removedCount = 0;

    // Delete the main file
    try {
      await fs.unlink(fullPath);
      removedCount++;
    } catch {}

    // Also try to clean up any legacy size-variant files in the same directory
    try {
      const files = await fs.readdir(dir);
      const variants = files.filter(f => {
        const m = f.match(/^(\d+)(?:-|\.)/);
        return m && m[1] === id && f !== filename;
      });

      for (const variant of variants) {
        try {
          await fs.unlink(path.join(dir, variant));
          removedCount++;
        } catch {}
      }
    } catch {
      // Directory might not exist or be empty, that's fine
    }

    // Delete all DB entries for this ID prefix
    const category = dbPath.split('/')[0];
    if (category) {
      deleteMetadata(fullPath);
      // Also delete any legacy entries with size variants
      const prefix = dbPath.replace(filename, `${id}`);
      const relatedPaths = findByPrefix(prefix);
      for (const p of relatedPaths) {
        deleteMetadata(`./cache/${p}`);
      }
    }

    return removedCount;
  }

  /**
   * Evict images not accessed in EVICTION_MAX_AGE_DAYS days.
   * Skip oldcharacters (static archive).
   */
  private async evictStaleEntries() {
    console.log('Starting cache eviction sweep...');
    const cutoff = Date.now() - (EVICTION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    let totalEvicted = 0;

    // Keep evicting in batches until no more stale entries
    let batch = getStaleEntries(cutoff, 'oldcharacters/', EVICTION_BATCH_SIZE);
    while (batch.length > 0) {
      for (const entry of batch) {
        try {
          await fs.unlink(`./cache/${entry.cache_path}`);
        } catch {}
        deleteMetadata(`./cache/${entry.cache_path}`);
        totalEvicted++;
      }
      if (batch.length < EVICTION_BATCH_SIZE) break;
      batch = getStaleEntries(cutoff, 'oldcharacters/', EVICTION_BATCH_SIZE);
    }

    this.stats.lastEvictionRun = Date.now();
    this.stats.totalEvicted += totalEvicted;

    if (totalEvicted > 0) {
      console.log(`Cache eviction completed. Evicted: ${totalEvicted} files`);
    }
  }

  /**
   * Determine the upstream URL for a cached image based on its path
   */
  private getUpstreamUrl(dbPath: string): string | null {
    const filename = path.basename(dbPath);
    const match = filename.match(/^(\d+)\./);
    if (!match) return null;
    const id = match[1];

    if (dbPath.startsWith('characters/')) {
      return `https://images.evetech.net/characters/${id}/portrait`;
    } else if (dbPath.startsWith('corporations/')) {
      return `https://images.evetech.net/corporations/${id}/logo`;
    } else if (dbPath.startsWith('alliances/')) {
      return `https://images.evetech.net/alliances/${id}/logo`;
    }

    return null;
  }
}

export const cacheValidator = new CacheValidator();
