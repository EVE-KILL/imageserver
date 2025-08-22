import { promises as fs } from 'node:fs';
import path from 'node:path';

export default defineEventHandler(async (event) => {
  try {
    const metadataPath = path.resolve('./images/service_metadata.json');
    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataContent);

    // Set proper JSON content type
    setHeader(event, 'content-type', 'application/json');

    return metadata;
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to read service metadata file'
    });
  }
});
