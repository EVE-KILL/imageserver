import { convertToWebp } from "./convertToWebp";
import { lruGet, lruSet, lruKey } from "./lruCache";

// Fetch and store the default character portrait ETag
let defaultCharacterETag: string | null = null;

export async function initDefaultCharacterETag() {
  try {
    const response = await fetch("https://images.evetech.net/characters/1/portrait", {
      method: "HEAD"
    });
    defaultCharacterETag = response.headers.get("ETag");
    console.log(`Default character portrait ETag: ${defaultCharacterETag}`);
  } catch (error) {
    console.error("Failed to fetch default character ETag:", error);
  }
}

export function getDefaultCharacterETag(): string | null {
  return defaultCharacterETag;
}

export async function getOldCharacterImage(id: string, webpRequested: boolean): Promise<{ found: boolean, image: ArrayBuffer | null, path: string | null }> {
  const jpgPath = `./cache/oldcharacters/${id}_256.jpg`;
  const missingJpgPath = `./cache/oldcharacters/missing_256.jpg`;

  let imagePath: string | null = null;

  // Find the source JPG
  if (await Bun.file(jpgPath).exists()) {
    imagePath = jpgPath;
  } else if (await Bun.file(missingJpgPath).exists()) {
    imagePath = missingJpgPath;
  }

  if (!imagePath) {
    return { found: false, image: null, path: null };
  }

  let image = await Bun.file(imagePath).arrayBuffer();

  // Convert to webp on the fly if needed, using LRU cache
  if (webpRequested) {
    const cacheKey = lruKey(imagePath, null, "webp");
    const cached = lruGet(cacheKey);
    if (cached) {
      image = cached;
    } else {
      image = await convertToWebp(image);
      lruSet(cacheKey, image);
    }
  }

  return { found: true, image, path: imagePath };
}
