import { access, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The folder holding the zips of the Extension Version this deployment carries (#989): apps/web/Dockerfile builds both
 * into the image and names it with EXTENSION_ZIP_DIR. Unset outside an image (`next dev`, a local build): no zip.
 */
export function extensionZipPath(zip: string, env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.EXTENSION_ZIP_DIR;
  return dir ? path.join(dir, path.basename(zip)) : null;
}

/** The zip's bytes, or null when this server has none (no EXTENSION_ZIP_DIR, or no such file in it). */
export async function readExtensionZip(zip: string, env: Record<string, string | undefined> = process.env): Promise<Buffer | null> {
  const file = extensionZipPath(zip, env);
  if (!file) return null;
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Whether this server serves the zip, for Outils to offer it or say it has none. */
export async function hasExtensionZip(zip: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const file = extensionZipPath(zip, env);
  if (!file) return false;
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
