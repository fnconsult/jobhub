import PDFDocument from "pdfkit";
import { fontBytes, isRightToLeft, isWinAnsi, runsOf, visualOrder, type Run } from "./fonts";
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
    // Right-to-left words are drawn one by one: pdfkit lays out a word with its trailing space, and fontkit would move that space in front of the word.
    const runs = runsOf(unicode ? visualOrder(block.text) : block.text, unicode, bold).flatMap((run) =>
      isRightToLeft(run.text) ? run.text.split(/(\s+)/).filter(Boolean).map((text) => ({ ...run, text })) : [run],
    );
    let x = A4.margin;
    let align: "center" | "left" = header && style.headerAlign === "center" ? "center" : "left";
    if (align === "center" && runs.length > 1) {
      // pdfkit centres each font run on its own and loses the spaces between them: centre the line by hand.
      const lineWidth = runs.reduce((sum, run) => sum + pdf.font(fontOf(run)).widthOfString(run.text), 0);
      if (lineWidth < width) x += (width - lineWidth) / 2;
      align = "left";
    }
    runs.forEach((run, i) => {
      const options = { width: width - (x - A4.margin), align, paragraphGap: style.space.afterLine, continued: i < runs.length - 1 };
      pdf.font(fontOf(run));
      if (i === 0) pdf.text(run.text, x, pdf.y, options);
      else pdf.text(run.text, options);
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
