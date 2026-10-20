import { inflateRawSync } from "node:zlib";

/**
 * The content of the first entry of a zip archive whose name `matches`; null when none does.
 * Enough for the archives the reference data comes in: stored or deflated entries, no zip64,
 * no encryption. Throws on an archive it cannot read.
 */
export function zipEntry(archive: Uint8Array, matches: (name: string) => boolean): Buffer | null {
  const zip = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  // The end of central directory record: 22 bytes, then a comment of up to 65 535.
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive");
  const entries = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("unreadable zip central directory");
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localHeader = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!matches(name)) continue;
    if (zip.readUInt32LE(localHeader) !== 0x04034b50) throw new Error(`unreadable zip entry ${name}`);
    const start = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`zip entry ${name} is compressed by method ${method}`);
  }
  return null;
}
