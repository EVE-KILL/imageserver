import { cacheValidator } from '../utils/cacheValidator';

export default defineNitroPlugin(() => {
  // Start the background cache validation service
  cacheValidator.start();

  console.log('Cache validator service initialized');
});
