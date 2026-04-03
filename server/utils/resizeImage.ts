import sharp from 'sharp';

// Limit libvips internal cache to prevent unbounded native memory growth
sharp.cache({ memory: 128, files: 20, items: 200 });
sharp.concurrency(1);

export async function resizeImage(buffer: ArrayBuffer, size: number): Promise<ArrayBuffer> {
  const img = sharp(buffer);
  const metadata = await img.metadata();
  const width = metadata.width || size;
  if (width <= size) {
    return buffer;
  }
  const outputBuffer = await img.resize(size, size, { fit: 'inside' }).toBuffer();
  return outputBuffer.buffer.slice(
    outputBuffer.byteOffset,
    outputBuffer.byteOffset + outputBuffer.byteLength
  ) as ArrayBuffer;
}
