import type { LegalDocument } from "@jobhub/help";
import { createI18n } from "@jobhub/shared/i18n";
import { coachReplyBlocks, type Line } from "@/coach/reply-text";
import type { Block } from "@/export/layout";
import { renderPdf } from "@/export/pdf";
import { TEMPLATE_STYLES } from "@/export/templates";
import { writtenDay } from "./days";

const text = (line: Line) => line.map((run) => run.text).join("");

/**
 * A Legal Document's lines in its PDF (« Télécharger en PDF », #470), in its language: its title, effective date and
 * version, « En bref », then each numbered section, its paragraphs and list items as plain text.
 */
export function legalPdfBlocks(document: LegalDocument): Block[] {
  const { t } = createI18n(document.locale);
  const blocks: Block[] = [
    { kind: "name", text: document.title },
    { kind: "contact", text: `${t("legal.effective", { date: writtenDay(document.effective, document.locale) })} · ${t("legal.version", { version: document.version })}` },
  ];
  if (document.summary.length > 0) {
    blocks.push({ kind: "heading", text: t("legal.summary") });
    for (const line of document.summary) blocks.push({ kind: "text", text: `• ${line}` });
  }
  for (const section of document.sections) {
    blocks.push({ kind: "heading", text: `${section.number}. ${section.title}` });
    coachReplyBlocks(section.body).forEach((block, index) => {
      if (index > 0) blocks.push({ kind: "gap" });
      if (block.kind === "paragraph") blocks.push({ kind: "text", text: block.lines.map(text).join(" ") });
      else block.items.forEach((item, at) => blocks.push({ kind: "text", text: `${block.ordered ? `${block.start + at}.` : "•"} ${item.map(text).join(" ")}` }));
    });
  }
  return blocks;
}

/** The PDF of a Legal Document's version: real, selectable text, named « <title> <version>.pdf ». */
export async function legalDocumentPdf(document: LegalDocument): Promise<{ fileName: string; bytes: Uint8Array }> {
  const fileName = `${document.title} ${document.version}.pdf`;
  return { fileName, bytes: await renderPdf(legalPdfBlocks(document), TEMPLATE_STYLES.modern, fileName) };
}
