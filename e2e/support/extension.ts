import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

/** Built by the extension spec against the e2e web server (`wxt build --mode e2e`). */
export const e2eExtensionDir = path.join(realpathSync("apps/extension"), ".output/chrome-mv3-e2e");

/** Chromium derives an unpacked extension's id from the SHA-256 of its absolute path. */
export function unpackedExtensionId(dir: string): string {
  const hex = createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}
