import sharp from "sharp";
import { COACH_PHOTO_MAX_BYTES, COACH_PHOTO_MAX_PIXELS } from "./limits";
/** Decode bounded raster input, apply orientation, remove EXIF and re-encode a small self-hosted WebP. */
export async function normalizeCoachPhoto(bytes: Uint8Array): Promise<Buffer | null> {
  if (!bytes.length || bytes.length > COACH_PHOTO_MAX_BYTES) return null;
  const head = Buffer.from(bytes.subarray(0, 12));
  const raster =
    head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (head[0] === 255 && head[1] === 216 && head[2] === 255) ||
    (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP");
  if (!raster) return null;
  try {
    const image = sharp(bytes, { limitInputPixels: COACH_PHOTO_MAX_PIXELS, failOn: "error", animated: false });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1) return null;
    return await image.rotate().resize(512, 512, { fit: "cover", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}
