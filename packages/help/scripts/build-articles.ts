/**
 * Checks the Help Articles' and the Release Notes' Markdown files and writes them as src/articles.generated.ts and
 * src/release-notes.generated.ts, the modules the app bundles.
 */
import { writeFileSync } from "node:fs";
import { generatedModulePath, readHelpContent, renderArticlesModule } from "../src/content";
import { readReleaseNotes, releaseNotesModulePath, renderReleaseNotesModule } from "../src/release-notes-content";

const content = readHelpContent();
writeFileSync(generatedModulePath, renderArticlesModule(content));
console.log(`Help Articles: ${content.fr.length} in French and English → ${generatedModulePath}`);

const notes = readReleaseNotes();
writeFileSync(releaseNotesModulePath, renderReleaseNotesModule(notes));
console.log(`Release Notes: ${notes.fr.length} in French and English → ${releaseNotesModulePath}`);
