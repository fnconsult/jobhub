# Issue #468: Candidate pages, file upload and the PDF / DOCX viewer

Scope: only the library facts needed to pick and self-host the PDF and DOCX rendering for the viewer. Checked 2026-10-30. "Not verified" means the primary source was not retrievable; confirm in the PR.

## PDF rendering: pdf.js (`pdfjs-dist`)
Sources: https://github.com/mozilla/pdf.js , `npm view pdfjs-dist` (npm registry)
- License Apache-2.0. npm package `pdfjs-dist`. Latest on the registry: 6.4.299 (modified 2026-10-03). Its `engines` field requires Node >=22.13 or >=24 (a build-time concern for tooling, not the browser).
- The modern build assumes recent JavaScript features in the browser; a `legacy` build exists for older browsers (README).
- The library needs a separate worker file, and library and worker must be the exact same version (pdf.js FAQ). Self-hosting means shipping both from the same `pdfjs-dist` install and pointing `GlobalWorkerOptions.workerSrc` at the bundled worker. Not verified: the exact bundler import recipe (the wiki page "Setup PDF.js in a website" was not retrievable); check against the installed version.
- Not verified: CSP requirements. If the app sets `worker-src`/`script-src`, serve the worker from the same origin.
- pdf.js gives page count, per-page render to canvas and viewport scaling, which covers "Page x sur y", zoom and thumbnails. The download button should serve the original file bytes, not a re-render, so "same file" holds.

## DOCX preview: docx-preview
Source: https://github.com/VolodymyrBaydalka/docxjs , `npm view docx-preview`
- License Apache-2.0, package `docx-preview` 0.4.1 (2026-09-21). Depends on JSZip.
- Stable API is `renderAsync(document, bodyContainer, styleContainer?, options?)`; `parseAsync`/`renderDocument` are experimental.
- It converts DOCX to semantic HTML; pagination is approximate and some Word features cannot be reproduced (no TOC fields, no real-time page breaking). It does not claim to match Word's layout.

## Implications for the issue
- Acceptance asks that the "DOCX preview renders the same layout as the export". docx-preview cannot guarantee that. Options: preview the exported DOCX with docx-preview and accept approximate pagination, or render a PDF from the same source for preview and offer DOCX as download. Decide before building.
- The repo already has `mammoth` (DOCX to HTML/text), `unpdf` and `pdfkit` in `apps/web/package.json`. Mammoth drops layout by design, so it is not a fit for a paper-style preview. `unpdf` is server-side text extraction, not a viewer.
- New dependencies to name in the PR: `pdfjs-dist` (and `docx-preview` if the DOCX path is kept), both Apache-2.0, both self-hosted via the bundler with no CDN.
- Pin exact versions; keep the pdf.js library and worker in lockstep.
