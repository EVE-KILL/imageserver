import sharp from 'sharp';

export async function convertToWebp(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const inputBuffer = Buffer.from(buffer);
  const outputBuffer = await sharp(inputBuffer).toFormat('webp').toBuffer();
  // Convert output Buffer to ArrayBuffer
  return outputBuffer.buffer.slice(
    outputBuffer.byteOffset,
    outputBuffer.byteOffset + outputBuffer.byteLength
  );
}
