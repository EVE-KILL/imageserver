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

  // Load the overlay and resize to target size
  const overlayBuffer = await Bun.file(overlayPath).arrayBuffer();
  const overlayImage = sharp(Buffer.from(overlayBuffer))
    .resize(targetOverlaySize, targetOverlaySize, {
      kernel: sharp.kernel.lanczos3, // High-quality resampling
      fit: 'fill',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    });

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
