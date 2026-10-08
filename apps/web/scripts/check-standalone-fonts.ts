/**
 * Checks that the standalone build carries every font file a PDF export may
 * embed, where the server looks for it (src/export/fonts.ts). Run after
 * `next build` (npm's postbuild).
 *
 * Inside the repo, a missing file would still be found in the repo's own
 * node_modules: this check only accepts files inside .next/standalone, the way
 * the container sees them.
 */
import path from "node:path";

const standalone = path.resolve(".next/standalone");
process.chdir(path.join(standalone, "apps/web"));
const { allFontFiles, fontBytes } = await import("../src/export/fonts");

let files: string[];
try {
  files = allFontFiles();
} catch (error) {
  console.error(`Standalone build is missing a font: ${(error as Error).message}`);
  process.exit(1);
}
const outside = files.filter((file) => !file.startsWith(standalone + path.sep));
if (outside.length > 0) {
  console.error(`Standalone build is missing fonts (see outputFileTracingIncludes in next.config.ts):\n${outside.join("\n")}`);
  process.exit(1);
}
files.forEach((file) => fontBytes(file));
console.log(`Standalone build carries all ${files.length} font files.`);
