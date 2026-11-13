/** Import the official downloaded archive, never a schema assembled from examples. No network call or legal approval. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
const archive = process.argv[2];
if (!archive) throw Error("Usage: tsx apps/web/scripts/import-dac7-schema.ts /absolute/path/to/official-2026.zip");
const names = execFileSync("unzip", ["-Z1", path.resolve(archive)], { encoding: "utf8" })
  .split("\n")
  .filter((name) => name.endsWith(".xsd"));
if (!names.length || names.some((name) => name.startsWith("/") || name.split("/").includes(".."))) throw Error("Invalid schema archive");
const files: Record<string, string> = {};
for (const name of names) {
  const basename = path.posix.basename(name);
  if (files[basename]) throw Error("Ambiguous schema basename");
  const content = execFileSync("unzip", ["-p", path.resolve(archive), name], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  files[basename] = content.replace(/schemaLocation="[^"\r\n]*\/([^"/]+\.xsd)"/g, 'schemaLocation="$1"');
}
const entry = Object.keys(files).find((name) => /name\s*=\s*["']DPI_OECD["']/.test(files[name]!));
if (!entry) throw Error("Official DPI root schema missing");
const target = path.resolve("apps/web/src/coaching-tax/schema-2026.generated.json");
const previous = JSON.parse(readFileSync(target, "utf8"));
writeFileSync(
  target,
  JSON.stringify({ source: previous.source, archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"), entry, files }, null, 2) + "\n",
);
process.stdout.write(`Imported ${names.length} official schema files; review source/checksum and run fiscal XML validation before claiming readiness.\n`);
