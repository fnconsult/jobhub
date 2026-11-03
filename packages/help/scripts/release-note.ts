/**
 * `npm run release-note -w @jobhub/help`: assembles the fragments of releases/unreleased/ into the next Version's draft
 * Release Note, releases/{fr,en}/X.Y.Z.md, then removes them (ADR-0063, #562). The next Version is the one `main`
 * carries: the root package.json's. The agent then rewrites the draft in one voice; the product owner validates it at
 * the Promotion.
 *
 * `-- --check` changes nothing: it says where the next Version's Release Note stands (the deploy-staging report).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleReleaseNote, describeReleaseNoteStatus, releaseNoteStatus } from "../src/release-note-fragments";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--check");
if (unknown.length > 0) {
  console.error(`option inconnue : ${unknown.join(" ")} (option : --check)`);
  process.exit(2);
}

if (args.includes("--check")) {
  console.log(describeReleaseNoteStatus(releaseNoteStatus({ version })));
} else {
  const assembly = assembleReleaseNote({ version, date: new Date().toISOString().slice(0, 10) });
  if (assembly.fragments.length === 0) console.log(`Aucun fragment dans releases/unreleased/ : la Release Note ${version} est inchangée.`);
  else {
    console.log(`Release Note ${version} : ${assembly.fragments.length} fragment(s) assemblé(s) → ${assembly.written.map((file) => `releases/${file}`).join(", ")}`);
    console.log("Réécrivez-la dans un ton unique" + (assembly.toWrite ? ", avec son titre et son introduction (« À écrire »)," : "") + " ; le product owner la valide à la Promotion.");
  }
}
