export function safePhotoSize(
  buffer: Buffer,
): { width: number; height: number } | null {
  let width = 0,
    height = 0;
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (buffer[0] === 255 && buffer[1] === 216) {
    let offset = 2;
    while (offset + 4 < buffer.length) {
      if (buffer[offset] !== 255) return null;
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 255) {
        offset--;
        continue;
      }
      if (marker === 217 || marker === 218) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) return null;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 7
      ) {
        height = buffer.readUInt16BE(offset + 3);
        width = buffer.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  return width > 0 && height > 0 && width <= 4096 && height <= 4096
    ? { width, height }
    : null;
}
