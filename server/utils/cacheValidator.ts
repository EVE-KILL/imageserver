import { promises as fs } from 'node:fs';
import path from 'node:path';

interface CacheMetadata {
  etag: string;
  lastChecked: number;
  lastModified: number;
  cacheExpiry: number; // 24 hours from last check
}

const CACHE_VALIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const METADATA_SUFFIX = '.meta.json';

export class CacheValidator {
  private validationTimer: NodeJS.Timeout | null = null;

  /**
   * Start the background cache validation service
   */
  start() {
    console.log('Starting background cache validator (24h intervals)');

    // Run initial validation after 5 minutes to let the server settle
    setTimeout(() => {
      this.validateAllCaches().catch(err =>
        console.error('Error in initial cache validation:', err)
      );
    }, 5 * 60 * 1000);

    // Then run every 6 hours (more frequent than our 24h cache time for better coverage)
    this.validationTimer = setInterval(() => {
      this.validateAllCaches().catch(err =>
        console.error('Error in scheduled cache validation:', err)
      );
    }, 6 * 60 * 60 * 1000);
  }

  /**
   * Stop the background validation service
   */
  stop() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
  }

  /**
   * Save cache metadata when an image is cached
   */
  async saveCacheMetadata(imagePath: string, etag: string | null) {
    if (!etag) return;

    const metadataPath = imagePath + METADATA_SUFFIX;
    const metadata: CacheMetadata = {
      etag,
      lastChecked: Date.now(),
      lastModified: Date.now(),
      cacheExpiry: Date.now() + CACHE_VALIDATION_INTERVAL
    };

    try {
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.error(`Failed to save cache metadata for ${imagePath}:`, error);
    }
  }

  /**
   * Load cache metadata for an image
   */
  async loadCacheMetadata(imagePath: string): Promise<CacheMetadata | null> {
    const metadataPath = imagePath + METADATA_SUFFIX;

    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(data) as CacheMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Check if a cached image needs validation
   */
  async needsValidation(imagePath: string): Promise<boolean> {
    const metadata = await this.loadCacheMetadata(imagePath);

    // If no metadata exists (legacy cached image), check file age
    if (!metadata) {
      try {
        const stats = await fs.stat(imagePath);
        const fileAge = Date.now() - stats.mtimeMs;
        // Consider files older than 24 hours as needing validation
        return fileAge > CACHE_VALIDATION_INTERVAL;
      } catch {
        return false;
      }
    }

    return Date.now() > metadata.cacheExpiry;
  }

  /**
   * Validate all cached images across all cache directories
   */
  private async validateAllCaches() {
    console.log('Starting cache validation sweep...');
    const startTime = Date.now();
    let validatedCount = 0;
    let removedCount = 0;

    const cacheDirs = [
      './cache/characters',
      './cache/corporations',
      './cache/alliances'
    ];

    for (const cacheDir of cacheDirs) {
      try {
        const results = await this.validateCacheDirectory(cacheDir);
        validatedCount += results.validated;
        removedCount += results.removed;
      } catch (error) {
        console.error(`Error validating cache directory ${cacheDir}:`, error);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Cache validation completed in ${duration}ms. Validated: ${validatedCount}, Removed: ${removedCount}`);
  }

  /**
   * Validate all images in a specific cache directory
   */
  private async validateCacheDirectory(cacheDir: string): Promise<{ validated: number; removed: number }> {
    let validated = 0;
    let removed = 0;

    try {
      const files = await fs.readdir(cacheDir);
      const imageFiles = files.filter(file =>
        !file.endsWith(METADATA_SUFFIX) &&
        (file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png') || file.endsWith('.webp'))
      );

      for (const file of imageFiles) {
        const imagePath = path.join(cacheDir, file);

        if (await this.needsValidation(imagePath)) {
          const result = await this.validateSingleImage(imagePath);
          if (result.action === 'validated') {
            validated++;
          } else if (result.action === 'removed') {
            removed++;
          }
        }
      }
    } catch (error) {
      console.error(`Error reading cache directory ${cacheDir}:`, error);
    }

    return { validated, removed };
  }

  /**
   * Validate a single cached image against upstream
   */
  private async validateSingleImage(imagePath: string): Promise<{ action: 'validated' | 'removed' | 'error' }> {
    try {
      let metadata = await this.loadCacheMetadata(imagePath);
      const upstreamUrl = this.getUpstreamUrl(imagePath);

      if (!upstreamUrl) {
        return { action: 'error' };
      }

      // Make a HEAD request to check the current ETag
      const response = await fetch(upstreamUrl, { method: 'HEAD' });
      const currentETag = response.headers.get('etag');

      if (!currentETag) {
        // No ETag from upstream, just update/create metadata
        if (!metadata) {
          await this.saveCacheMetadata(imagePath, 'no-etag');
        } else {
          metadata.lastChecked = Date.now();
          metadata.cacheExpiry = Date.now() + CACHE_VALIDATION_INTERVAL;
          await fs.writeFile(imagePath + METADATA_SUFFIX, JSON.stringify(metadata, null, 2));
        }
        return { action: 'validated' };
      }

      if (!metadata) {
        // Legacy cached image without metadata - create metadata with current ETag
        await this.saveCacheMetadata(imagePath, currentETag);
        console.log(`Created metadata for legacy cached image: ${imagePath}`);
        return { action: 'validated' };
      }

      if (currentETag !== metadata.etag) {
        // ETag changed, remove the cached image (and its metadata)
        await this.removeCachedImage(imagePath);
        console.log(`Removed stale cached image: ${imagePath}`);
        return { action: 'removed' };
      } else {
        // ETag same, update the cache expiry
        metadata.lastChecked = Date.now();
        metadata.cacheExpiry = Date.now() + CACHE_VALIDATION_INTERVAL;
        await fs.writeFile(imagePath + METADATA_SUFFIX, JSON.stringify(metadata, null, 2));
        return { action: 'validated' };
      }
    } catch (error) {
      console.error(`Error validating ${imagePath}:`, error);
      return { action: 'error' };
    }
  }

  /**
   * Remove a cached image and its metadata
   */
  private async removeCachedImage(imagePath: string) {
    try {
      await fs.unlink(imagePath);
    } catch (error) {
      console.error(`Error removing cached image ${imagePath}:`, error);
    }

    try {
      await fs.unlink(imagePath + METADATA_SUFFIX);
    } catch (error) {
      // Metadata file might not exist, that's okay
    }
  }

  /**
   * Determine the upstream URL for a cached image based on its path
   */
  private getUpstreamUrl(imagePath: string): string | null {
    const normalizedPath = imagePath.replace(/\\/g, '/');
    const filename = path.basename(normalizedPath);

    // Parse the filename to extract ID and parameters
    // Format: {id}.{ext} or {id}-{size}.{ext} or {id}-{params}.{ext}
    const match = filename.match(/^(\d+)(?:-(.+?))?\.(?:jpg|jpeg|png|webp)$/);
    if (!match) return null;

    const id = match[1];
    const params = match[2];

    if (normalizedPath.includes('/cache/characters/')) {
      return `https://images.evetech.net/characters/${id}/portrait`;
    } else if (normalizedPath.includes('/cache/corporations/')) {
      return `https://images.evetech.net/corporations/${id}/logo`;
    } else if (normalizedPath.includes('/cache/alliances/')) {
      return `https://images.evetech.net/alliances/${id}/logo`;
    }

    return null;
  }
}

// Export a singleton instance
export const cacheValidator = new CacheValidator();
