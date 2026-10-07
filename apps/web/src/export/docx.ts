import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from "docx";
import type { Block } from "./layout";
import type { TemplateStyle } from "./templates";

/** Points to the half-points and twentieths of a point Word measures in. */
const halfPoints = (points: number) => Math.round(points * 2);
const twips = (points: number) => Math.round(points * 20);

function paragraphOf(block: Exclude<Block, { kind: "gap" }>, style: TemplateStyle, gapBefore: boolean): Paragraph {
  const header = block.kind === "name" || block.kind === "headline" || block.kind === "contact";
  const size = { name: style.size.name, headline: style.size.headline, heading: style.size.heading }[block.kind as string] ?? style.size.body;
  return new Paragraph({
    alignment: header && style.headerAlign === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: {
      before: twips(block.kind === "heading" ? style.space.beforeHeading : gapBefore ? style.size.body : 0),
      after: twips(style.space.afterLine),
    },
    border:
      block.kind === "heading" && style.headingRule
        ? { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: style.headingColor } }
        : undefined,
    children: [
      new TextRun({
        text: block.text,
        font: style.docxFont,
        size: halfPoints(size),
        bold: block.kind === "name" || block.kind === "heading" || block.kind === "entry",
        color: block.kind === "heading" ? style.headingColor : undefined,
      }),
    ],
  });
}

/** A Word document: one paragraph per block, in a single section and column. */
export async function renderDocx(blocks: Block[], style: TemplateStyle, title: string): Promise<Uint8Array> {
  const paragraphs: Paragraph[] = [];
  let gapBefore = false;
  for (const block of blocks) {
    if (block.kind === "gap") gapBefore = true;
    else {
      paragraphs.push(paragraphOf(block, style, gapBefore));
      gapBefore = false;
    }
  }
  const document = new Document({
    title,
    creator: "Jobbbox",
    styles: { default: { document: { run: { font: style.docxFont, size: halfPoints(style.size.body) } } } },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children: paragraphs,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
