/**
 * Checks the Help Articles', the Release Notes' and the Legal Text Versions' Markdown files and writes them as
 * src/articles.generated.ts, src/release-notes.generated.ts and src/legal-texts.generated.ts, the modules the app bundles;
 * and the Motion Scripts (src/motions.generated.ts): each in French and in English, each named by one Tutorial's `motion`,
 * filming only pages the web app has (ADR-0066, #567).
 */
import { writeFileSync } from "node:fs";
import { generatedModulePath, readHelpContent, renderArticlesModule } from "../src/content";
import { checkMotionLinks, motionsModulePath, readAppRoutes, readMotionScripts, renderMotionsModule } from "../src/motion-scripts-content";
import { legalTextsModulePath, readLegalTexts, renderLegalTextsModule } from "../src/legal-texts-content";
import { readReleaseNotes, releaseNotesModulePath, renderReleaseNotesModule } from "../src/release-notes-content";

// Both checked before either is written: a Tutorial whose motion names no script leaves the bundled articles as they were.
const content = readHelpContent();
const motions = readMotionScripts();
checkMotionLinks(content, motions, readAppRoutes());
writeFileSync(generatedModulePath, renderArticlesModule(content));
console.log(`Help Articles: ${content.fr.length} in French and English → ${generatedModulePath}`);

writeFileSync(motionsModulePath, renderMotionsModule(motions));
console.log(`Motion Scripts: ${motions.fr.length} in French and English → ${motionsModulePath}`);

const notes = readReleaseNotes();
writeFileSync(releaseNotesModulePath, renderReleaseNotesModule(notes));
console.log(`Release Notes: ${notes.fr.length} in French and English → ${releaseNotesModulePath}`);

const legal = readLegalTexts();
writeFileSync(legalTextsModulePath, renderLegalTextsModule(legal));
console.log(`Legal Text Versions: ${legal.fr.length} in French and English → ${legalTextsModulePath}`);
