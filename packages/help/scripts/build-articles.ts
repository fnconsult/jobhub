/** Checks the Help Articles' Markdown files and writes them as src/articles.generated.ts, the module the app bundles. */
import { writeFileSync } from "node:fs";
import { generatedModulePath, readHelpContent, renderArticlesModule } from "../src/content";

const content = readHelpContent();
writeFileSync(generatedModulePath, renderArticlesModule(content));
console.log(`Help Articles: ${content.fr.length} in French and English → ${generatedModulePath}`);
