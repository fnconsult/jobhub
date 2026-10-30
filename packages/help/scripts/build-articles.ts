/**
 * Checks the Help Articles', the Release Notes' and the Legal Documents' Markdown files and writes them as
 * src/articles.generated.ts, src/release-notes.generated.ts and src/legal-documents.generated.ts, the modules the app bundles.
 */
import { writeFileSync } from "node:fs";
import { generatedModulePath, readHelpContent, renderArticlesModule } from "../src/content";
import { legalDocumentsModulePath, readLegalDocuments, renderLegalDocumentsModule } from "../src/legal-content";
import { readReleaseNotes, releaseNotesModulePath, renderReleaseNotesModule } from "../src/release-notes-content";

const content = readHelpContent();
writeFileSync(generatedModulePath, renderArticlesModule(content));
console.log(`Help Articles: ${content.fr.length} in French and English → ${generatedModulePath}`);

const notes = readReleaseNotes();
writeFileSync(releaseNotesModulePath, renderReleaseNotesModule(notes));
console.log(`Release Notes: ${notes.fr.length} in French and English → ${releaseNotesModulePath}`);

const legal = readLegalDocuments();
writeFileSync(legalDocumentsModulePath, renderLegalDocumentsModule(legal));
console.log(`Legal Documents: ${legal.fr.length} versions in French and English → ${legalDocumentsModulePath}`);
