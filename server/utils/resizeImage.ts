import sharp from 'sharp';

export async function resizeImage(buffer: ArrayBuffer, size: number): Promise<ArrayBuffer> {
  const inputBuffer = Buffer.from(buffer);
  const img = sharp(inputBuffer);
  const metadata = await img.metadata();
  const width = metadata.width || size;
  // Only resize if the original image is larger than the requested size.
  if (width <= size) {
    return buffer;
  }
  const outputBuffer = await img.resize(size, size, { fit: 'inside' }).toBuffer();
  return outputBuffer.buffer.slice(
    outputBuffer.byteOffset,
    outputBuffer.byteOffset + outputBuffer.byteLength
  );
}
