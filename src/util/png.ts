import * as fs from 'node:fs';

/** Width/height of a PNG file, or null if not a readable PNG. */
export function pngSize(absPath: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(absPath, 'r');
    try {
      const buf = Buffer.alloc(24);
      const n = fs.readSync(fd, buf, 0, 24, 0);
      if (n < 24) return null;
      if (buf.readUInt32BE(0) !== 0x89504e47) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
