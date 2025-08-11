import sharp from 'sharp';

/**
 * Applies an overlay to an image in the top-left corner
 * The overlay will be scaled appropriately based on the base image size
 */
export async function applyOverlay(
  baseImageBuffer: ArrayBuffer, 
  overlayType: string
): Promise<ArrayBuffer> {
  const overlayPath = `./overlays/${overlayType}.png`;
  
  // Check if overlay file exists
  if (!await Bun.file(overlayPath).exists()) {
    console.warn(`Overlay file not found: ${overlayPath}`);
    return baseImageBuffer;
  }

  const baseImage = sharp(Buffer.from(baseImageBuffer));
  const metadata = await baseImage.metadata();
  const baseWidth = metadata.width || 64;
  
  // Calculate target overlay size (1:4 ratio)
  const targetOverlaySize = Math.max(16, Math.floor(baseWidth / 4));
  
  // Choose the best pre-generated overlay size
  let bestOverlaySize: number;
  let selectedOverlayPath: string;
  
  if (targetOverlaySize <= 24) {
    // Use 16x16 original for small overlays
    bestOverlaySize = 16;
    selectedOverlayPath = overlayPath;
  } else if (targetOverlaySize <= 48) {
    // Use 32x32 for medium overlays
    bestOverlaySize = 32;
    selectedOverlayPath = `./overlays/${overlayType}-32.png`;
  } else if (targetOverlaySize <= 96) {
    // Use 64x64 for large overlays
    bestOverlaySize = 64;
    selectedOverlayPath = `./overlays/${overlayType}-64.png`;
  } else {
    // Use 128x128 for very large overlays
    bestOverlaySize = 128;
    selectedOverlayPath = `./overlays/${overlayType}-128.png`;
  }
  
  // Check if the selected overlay file exists, fallback to original if not
  if (!await Bun.file(selectedOverlayPath).exists()) {
    console.warn(`Selected overlay file not found: ${selectedOverlayPath}, falling back to original`);
    selectedOverlayPath = overlayPath;
    bestOverlaySize = 16;
  }
  
  // Load the selected overlay
  const overlayBuffer = await Bun.file(selectedOverlayPath).arrayBuffer();
  let overlayImage = sharp(Buffer.from(overlayBuffer));
  
  // Only resize if the source size doesn't match target size exactly
  if (bestOverlaySize !== targetOverlaySize) {
    overlayImage = overlayImage.resize(targetOverlaySize, targetOverlaySize, { 
      kernel: sharp.kernel.lanczos3, // High-quality resampling
      fit: 'fill',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    });
  }
  
  const resizedOverlay = await overlayImage.png().toBuffer();

  // Composite the overlay onto the base image in the top-left corner
  const result = await baseImage
    .composite([{
      input: resizedOverlay,
      top: 0,
      left: 0
    }])
    .toBuffer();

  return result.buffer as ArrayBuffer;
}
