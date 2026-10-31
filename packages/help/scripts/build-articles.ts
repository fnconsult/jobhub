/**
 * Checks the Help Articles', the Release Notes' and the Legal Text Versions' Markdown files and writes them as
 * src/articles.generated.ts, src/release-notes.generated.ts and src/legal-texts.generated.ts, the modules the app bundles.
 */
import { writeFileSync } from "node:fs";
import { generatedModulePath, readHelpContent, renderArticlesModule } from "../src/content";
import { legalTextsModulePath, readLegalTexts, renderLegalTextsModule } from "../src/legal-texts-content";
import { readReleaseNotes, releaseNotesModulePath, renderReleaseNotesModule } from "../src/release-notes-content";

const content = readHelpContent();
writeFileSync(generatedModulePath, renderArticlesModule(content));
console.log(`Help Articles: ${content.fr.length} in French and English → ${generatedModulePath}`);

const notes = readReleaseNotes();
writeFileSync(releaseNotesModulePath, renderReleaseNotesModule(notes));
console.log(`Release Notes: ${notes.fr.length} in French and English → ${releaseNotesModulePath}`);

const legal = readLegalTexts();
writeFileSync(legalTextsModulePath, renderLegalTextsModule(legal));
console.log(`Legal Text Versions: ${legal.fr.length} in French and English → ${legalTextsModulePath}`);
