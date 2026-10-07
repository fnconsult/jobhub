import PDFDocument from "pdfkit";
import type { Block } from "./layout";
import type { TemplateStyle } from "./templates";

/** A4, with 2 cm margins (in points). */
const A4 = { size: [595.28, 841.89] as [number, number], margin: 56.7 };

/** A PDF of real, selectable text: one column, standard fonts, no images. */
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

    pdf
      .font(bold ? style.pdfFont.bold : style.pdfFont.regular)
      .fontSize(size)
      .fillColor(block.kind === "heading" ? `#${style.headingColor}` : "#000000")
      .text(block.text, A4.margin, pdf.y, {
        width,
        align: header && style.headerAlign === "center" ? "center" : "left",
        paragraphGap: style.space.afterLine,
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
