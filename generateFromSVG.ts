#!/usr/bin/env bun
import sharp from 'sharp';
import { readdir } from 'fs/promises';

const OVERLAY_SIZES = [32, 64, 128];
const INPUT_DIR = './overlays';
const OUTPUT_DIR = './overlays';

async function generateFromSVG() {
  console.log('Generating high-quality overlay images from SVG...');
  
  // Get all SVG files in the overlays directory
  const files = await readdir(INPUT_DIR);
  const svgFiles = files.filter(file => file.endsWith('.svg'));
  
  if (svgFiles.length === 0) {
    console.log('No SVG files found. Please create SVG versions of your overlays first.');
    return;
  }
  
  for (const file of svgFiles) {
    const baseName = file.replace('.svg', '');
    console.log(`Processing ${baseName}.svg...`);
    
    const inputPath = `${INPUT_DIR}/${file}`;
    
    for (const size of OVERLAY_SIZES) {
      const outputPath = `${OUTPUT_DIR}/${baseName}-${size}.png`;
      
      try {
        console.log(`  Rendering to ${size}x${size}...`);
        
        // Render SVG to PNG at exact target size - no scaling needed!
        await sharp(inputPath)
          .resize(size, size, { 
            fit: 'fill',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
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
  
  console.log('SVG overlay generation complete!');
}

// Run the script
generateFromSVG().catch(console.error);
