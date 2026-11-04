/**
 * `npm run store-whats-new -w @jobhub/help -- <dir>`: writes the stores' « Nouveautés » of the app's Version (#704),
 * taken from its Release Note (ADR-0063), as Google Play reads them: `<dir>/whatsnew-fr-FR` and `<dir>/whatsnew-en-US`.
 * The same texts go to the App Store's « What's New ». The Version is the one the build carries: the root
 * package.json's. `.github/workflows/mobile.yml` runs it beside each store build (docs/ops/mobile.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readReleaseNotes } from "../src/release-notes-content";
import { storeWhatsNew } from "../src/store-whats-new";
import type { HelpLocale } from "../src/types";

const STORE_LOCALES: Record<HelpLocale, string> = { fr: "fr-FR", en: "en-US" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
const [dir, ...rest] = process.argv.slice(2);
if (!dir || rest.length > 0) {
  console.error("usage : npm run store-whats-new -w @jobhub/help -- <dossier>");
  process.exit(2);
}

const notes = readReleaseNotes();
mkdirSync(dir, { recursive: true });
for (const [locale, storeLocale] of Object.entries(STORE_LOCALES) as [HelpLocale, string][]) {
  const note = notes[locale].find((candidate) => candidate.version === version) ?? null;
  const text = storeWhatsNew(note, locale);
  writeFileSync(path.join(dir, `whatsnew-${storeLocale}`), `${text}\n`);
  console.log(`── ${storeLocale} (${version}${note ? "" : ", sans Release Note"})\n${text}\n`);
}
