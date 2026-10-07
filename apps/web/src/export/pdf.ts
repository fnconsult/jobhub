import PDFDocument from "pdfkit";
import { fontBytes, isWinAnsi, passagesOf, runsOf, type Run, type UnicodeFamily } from "./fonts";
import { readInLogicalOrder } from "./logical-text";
import type { Block } from "./layout";
import type { TemplateStyle } from "./templates";

/** A4, with 2 cm margins (in points). */
const A4 = { size: [595.28, 841.89] as [number, number], margin: 56.7 };

/**
 * A PDF of real, selectable text: one column, no images. Standard fonts when
 * every character fits them, embedded Unicode fonts otherwise (see fonts.ts).
 */
export function renderPdf(blocks: Block[], style: TemplateStyle, title: string): Promise<Uint8Array> {
  const pdf = new PDFDocument({
    size: A4.size,
    margin: A4.margin,
    info: { Title: title, Creator: "Jobbbox" },
    pdfVersion: "1.7",
    tagged: true,
  });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    pdf.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    pdf.on("error", reject);
  });

  const width = pdf.page.width - A4.margin * 2;
  const unicode = blocks.every((block) => block.kind === "gap" || isWinAnsi(block.text)) ? undefined : style.pdfUnicodeFamily;
  const registered = new Set<string>();
  let gapBefore = false;
  for (const block of blocks) {
    if (block.kind === "gap") {
      gapBefore = true;
      continue;
    }
    const header = block.kind === "name" || block.kind === "headline" || block.kind === "contact";
    const bold = block.kind === "name" || block.kind === "heading" || block.kind === "entry";
    const size = { name: style.size.name, headline: style.size.headline, heading: style.size.heading }[block.kind as string] ?? style.size.body;
    if (block.kind === "heading") pdf.moveDown(style.space.beforeHeading / style.size.body);
    else if (gapBefore) pdf.moveDown(1);
    gapBefore = false;

    pdf.fontSize(size).fillColor(block.kind === "heading" ? `#${style.headingColor}` : "#000000");
    const fontOf = (run: Run) => {
      if (!run.file) return bold ? style.pdfFont.bold : style.pdfFont.regular;
      // Registered from its bytes: pdfkit would read a WOFF with fontkit's inflater, which rejects some valid files.
      if (!registered.has(run.file)) pdf.registerFont(run.file, fontBytes(run.file));
      registered.add(run.file);
      return run.file;
    };
    const pieces = piecesOf(block.text, unicode, bold);
    const runs = pieces.map((piece) => piece.run);
    let x = A4.margin;
    let align: "center" | "left" = header && style.headerAlign === "center" ? "center" : "left";
    if (align === "center" && runs.length > 1) {
      // pdfkit centres each font run on its own and loses the spaces between them: centre the line by hand.
      const lineWidth = runs.reduce((sum, run) => sum + pdf.font(fontOf(run)).widthOfString(run.text), 0);
      if (lineWidth < width) x += (width - lineWidth) / 2;
      align = "left";
    }
    pieces.forEach(({ run, opens, closes }, i) => {
      const options = { width: width - (x - A4.margin), align, paragraphGap: style.space.afterLine, continued: i < pieces.length - 1 };
      // A right-to-left passage is marked content of its own, so that text extractors read it apart from the left-to-right text around it.
      if (opens) pdf.markContent("Span", {});
      pdf.font(fontOf(run));
      readInLogicalOrder(pdf);
      if (i === 0) pdf.text(run.text, x, pdf.y, options);
      else pdf.text(run.text, options);
      if (closes) pdf.endMarkedContent();
    });
    if (block.kind === "heading" && style.headingRule) {
      const y = pdf.y - style.space.afterLine + 1;
      pdf
        .moveTo(A4.margin, y)
        .lineTo(A4.margin + width, y)
        .lineWidth(0.5)
        .strokeColor(`#${style.headingColor}`)
        .stroke();
      pdf.y += 2;
    }
  }
  pdf.end();
  return done;
}

interface Piece {
  run: Run;
  /** The first piece of a right-to-left passage. */
  opens: boolean;
  /** The last piece of a right-to-left passage. */
  closes: boolean;
}

/**
 * The runs that draw a line, left to right. A right-to-left passage is drawn
 * in DejaVu Sans (the font of Arabic and Hebrew), spaces and numbers included,
 * and word by word: pdfkit lays out a word with its trailing space, and fontkit
 * would move that space in front of the word.
 */
function piecesOf(text: string, unicode: UnicodeFamily | undefined, bold: boolean): Piece[] {
  if (!unicode) return runsOf(text, undefined, bold).map((run) => ({ run, opens: false, closes: false }));
  return passagesOf(text).flatMap((passage) => {
    if (!passage.rightToLeft) return runsOf(passage.text, unicode, bold).map((run) => ({ run, opens: false, closes: false }));
    const runs = runsOf(passage.text, "DejaVuSans", bold).flatMap((run) =>
      run.text
        .split(/(\s+)/)
        .filter(Boolean)
        .map((text) => ({ ...run, text })),
    );
    return runs.map((run, i) => ({ run, opens: i === 0, closes: i === runs.length - 1 }));
  });
}
