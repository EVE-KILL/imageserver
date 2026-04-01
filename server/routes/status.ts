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
