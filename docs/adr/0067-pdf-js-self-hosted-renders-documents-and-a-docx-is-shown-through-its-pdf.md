# pdf.js, self-hosted, renders documents; a DOCX is shown through its PDF

Status: accepted (#468)

The Viewer shows a Tailored CV or Cover Letter export in the browser.

- **pdf.js** (`pdfjs-dist`, Apache-2.0, pinned exactly) draws the PDF. The library and its worker come from the same install, are bundled by Next.js and served from the app's own origin: no CDN, so no third party sees the Candidate's CV and the Content Security Policy stays closed.
- **A Word document is shown through the PDF** the export draws from the same content, with the Word file offered beside it. The preview has the export's layout, and no second converter (`docx-preview`) can disagree with it.
- **The Viewer reads the file once** and « Télécharger » gives those bytes, because an export is drawn again on every request.
- pdf.js draws the PDF standard fonts with system fonts, as its `standard_fonts` folder is not served.

Alternatives not taken: the browser's own PDF frame (no control of look, zoom or thumbnails, differs per browser) and `docx-preview` (a second layout engine).
