import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeCoachPhoto } from "./photo";
describe("professional portrait normalization", () => {
  it("applies EXIF orientation, strips metadata, and emits only a bounded WebP", async () => {
    const source = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 90, b: 70 } } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const normalized = await normalizeCoachPhoto(source);
    expect(normalized).not.toBeNull();
    const metadata = await sharp(normalized!).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
  it("rejects SVG, truncated raster files, oversized bodies and decompression-sized images", async () => {
    expect(await normalizeCoachPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'))).toBeNull();
    expect(await normalizeCoachPhoto(Buffer.from([255, 216, 255, 0]))).toBeNull();
    expect(await normalizeCoachPhoto(new Uint8Array(10 * 1024 * 1024 + 1))).toBeNull();
    const large = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    expect(await normalizeCoachPhoto(large)).toBeNull();
  });
});
