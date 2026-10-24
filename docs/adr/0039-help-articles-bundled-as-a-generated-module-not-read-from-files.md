# Help Articles are written as Markdown but bundled as a generated, committed module

The Help Articles (#347) are reviewed by a person, so they are Markdown files, one per article and language (`packages/help/articles/{fr,en}`). Search must also run in the browser, in the Coach Panel, with no request. We decided that `npm run build -w @jobhub/help` turns the files into `src/articles.generated.ts`, which is committed and is what the package serves; `readHelpContent()` reads the files in Node only, to check them. A test fails when the module no longer matches the Markdown.

## Considered Options

- **Read the files at run time**: needs the file system, so no search in the browser and a file copy in every image.
- **An API route serving the articles**: a request per search, and the page article could not be shown while offline or slow.
- **Content in the database**: no review in a pull request, and a Back Office to build for text that changes with the product.

## Consequences

- Editing an article means rebuilding the module; the stale-module test and the root `npm run build` (help first) catch a forgotten one.
- Articles ship with the web app; changing one is a release, not a Back Office edit.
