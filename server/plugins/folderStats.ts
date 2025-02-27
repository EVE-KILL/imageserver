import { initFolderStats } from '../utils/folderStats';

export default defineNitroPlugin(() => {
  // Initialize folder stats calculation without awaiting
  // This allows the server to start immediately
  initFolderStats();
});
