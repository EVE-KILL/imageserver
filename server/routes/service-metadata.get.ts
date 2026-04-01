import { promises as fs } from 'node:fs';
import path from 'node:path';

let cachedMetadata: unknown = null;

export default defineEventHandler(async (event) => {
  if (!cachedMetadata) {
    try {
      const metadataPath = path.resolve('./images/service_metadata.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      cachedMetadata = JSON.parse(metadataContent);
    } catch (error) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to read service metadata file'
      });
    }
  }

  setHeader(event, 'content-type', 'application/json');
  return cachedMetadata;
});
