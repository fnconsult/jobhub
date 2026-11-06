// Writes the proxy's fallback error pages into deploy/edge/pages (src/edge/pages.ts, ADR-0094). Run after changing
// their text or the design tokens: `npm run edge-pages -w @jobhub/web`. src/edge/pages.test.ts fails while the
// committed files differ.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { edgePageFiles } from "../src/edge/pages";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../deploy/edge/pages");
mkdirSync(dir, { recursive: true });
const files = edgePageFiles();
for (const name of readdirSync(dir)) if (!(name in files)) rmSync(path.join(dir, name));
for (const [name, html] of Object.entries(files)) writeFileSync(path.join(dir, name), html);
console.log(`✓ ${Object.keys(files).length} pages in ${path.relative(process.cwd(), dir)}`);
