import { convertToWebp } from "./convertToWebp";

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
  // Define file paths
  const jpgPath = `./cache/oldcharacters/${id}_256.jpg`;
  const webpPath = `./cache/oldcharacters/${id}_256.webp`;
  const missingJpgPath = `./cache/oldcharacters/missing_256.jpg`;
  const missingWebpPath = `./cache/oldcharacters/missing_256.webp`;

  let imagePath: string | null = null;
  let needsConversion = false;

  // Determine which file to use
  if (webpRequested) {
    // Check for existing webp version first
    if (await Bun.file(webpPath).exists()) {
      imagePath = webpPath;
    }
    // Check for jpg version that can be converted
    else if (await Bun.file(jpgPath).exists()) {
      imagePath = jpgPath;
      needsConversion = true;
    }
    // Check for missing webp fallback
    else if (await Bun.file(missingWebpPath).exists()) {
      imagePath = missingWebpPath;
    }
    // Fall back to missing jpg that needs conversion
    else if (await Bun.file(missingJpgPath).exists()) {
      imagePath = missingJpgPath;
      needsConversion = true;
    }
  } else {
    // For non-webp requests, use jpg directly
    if (await Bun.file(jpgPath).exists()) {
      imagePath = jpgPath;
    } else if (await Bun.file(missingJpgPath).exists()) {
      imagePath = missingJpgPath;
    }
  }

  // If we didn't find a file, return not found
  if (!imagePath) {
    return { found: false, image: null, path: null };
  }

  // Load the image
  let image = await Bun.file(imagePath).arrayBuffer();

  // Convert to webp if needed
  if (needsConversion && webpRequested) {
    image = await convertToWebp(image);

    // Save the converted webp for future use
    const savePath = imagePath === jpgPath ? webpPath : missingWebpPath;
    await Bun.file(savePath).write(image);
    imagePath = webpPath;
  }

  return { found: true, image, path: imagePath };
}
