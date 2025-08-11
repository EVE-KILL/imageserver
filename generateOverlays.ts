#!/usr/bin/env bun
import sharp from 'sharp';
import { readdir } from 'fs/promises';

const OVERLAY_SIZES = [32, 64, 128];
const INPUT_DIR = './overlays';
const OUTPUT_DIR = './overlays';

async function generateOverlaySizes() {
  console.log('Generating overlay images with advanced edge smoothing...');

  // Get all PNG files in the overlays directory
  const files = await readdir(INPUT_DIR);
  const pngFiles = files.filter(file => file.endsWith('.png') && !file.includes('-'));

  for (const file of pngFiles) {
    const baseName = file.replace('.png', '');
    console.log(`Processing ${baseName}...`);

    const inputPath = `${INPUT_DIR}/${file}`;

    for (const size of OVERLAY_SIZES) {
      const outputPath = `${OUTPUT_DIR}/${baseName}-${size}.png`;

      try {
        console.log(`  Creating ${size}x${size} with edge smoothing...`);

        // Multi-step approach for better quality:
        // 1. First scale to 2x target using nearest neighbor
        // 2. Apply selective gaussian blur to smooth only the edges
        // 3. Scale down to final size with high-quality sampling
        // 4. Apply light sharpening to restore crisp edges

        const intermediateSize = size * 2;

        const step1 = await sharp(inputPath)
          .resize(intermediateSize, intermediateSize, {
            kernel: sharp.kernel.nearest,
            fit: 'fill',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer();

        // Apply a very targeted blur that affects edges more than solid areas
        const step2 = await sharp(step1)
          .blur(0.8) // Light blur to smooth edges
          .png()
          .toBuffer();

        // Scale down with high quality and apply light sharpening
        await sharp(step2)
          .resize(size, size, {
            kernel: sharp.kernel.lanczos3,
            fit: 'fill',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .sharpen({
            sigma: 0.5,
            m1: 1.0,
            m2: 2.0,
            x1: 2,
            y2: 10
          })
          .modulate({
            brightness: 1.0,
            saturation: 1.05 // Slight saturation boost to compensate for blur
          })
          .png({
            compressionLevel: 9,
            adaptiveFiltering: true
          })
          .toFile(outputPath);

        console.log(`  ✓ Created ${baseName}-${size}.png`);
      } catch (error) {
        console.error(`  Error creating ${outputPath}:`, error);
      }
    }
  }

  console.log('Overlay generation complete!');
}

// Run the script
generateOverlaySizes().catch(console.error);
