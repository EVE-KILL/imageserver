import sharp from 'sharp';

export async function convertToWebp(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const outputBuffer = await sharp(buffer).toFormat('webp').toBuffer();
  return outputBuffer.buffer.slice(
    outputBuffer.byteOffset,
    outputBuffer.byteOffset + outputBuffer.byteLength
  ) as ArrayBuffer;
}
