import { getCurrentStats } from '../utils/folderStats';
import { cacheValidator } from '../utils/cacheValidator';
import { lruStats } from '../utils/lruCache';

export default defineEventHandler(async () => {
  const folderStats = getCurrentStats();
  const cacheValidationStats = cacheValidator.getStats();

  return {
    folderStats,
    lruCache: lruStats(),
    cacheValidation: {
      ...cacheValidationStats,
      lastValidationRun: cacheValidationStats.lastValidationRun
        ? new Date(cacheValidationStats.lastValidationRun).toISOString()
        : null,
      lastEvictionRun: cacheValidationStats.lastEvictionRun
        ? new Date(cacheValidationStats.lastEvictionRun).toISOString()
        : null,
      nextValidationEstimate: cacheValidationStats.lastValidationRun
        ? new Date(cacheValidationStats.lastValidationRun + 6 * 60 * 60 * 1000).toISOString()
        : null,
      averageValidationDurationMs: Math.round(cacheValidationStats.averageValidationDuration)
    }
  };
});
