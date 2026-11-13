import { TEST_BUILD_EXTENSION_ORIGIN } from "@jobhub/shared/extension-test-build";
import { extensionOriginsFromEnv } from "@/auth/extension-origins";
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

/**
 * Whether this server recognises the test zip (2026-11-13 regression): its fixed origin is among the extension origins
 * the web app trusts (EXTENSION_ORIGINS). Without it, the zip loaded reads the session, and every call that acts with
 * it, a Capture or an error report, is refused (403).
 */
export function recognisesTestBuild(extensionOrigins: readonly string[] = extensionOriginsFromEnv()): boolean {
  return extensionOrigins.includes(TEST_BUILD_EXTENSION_ORIGIN);
}
