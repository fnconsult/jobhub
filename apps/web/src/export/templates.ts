/**
 * The CV Templates: how each kind of block looks. Every template is ATS-safe by
 * construction: one column of real text, standard fonts, no images, tables,
 * text boxes, headers or footers. Templates only change fonts, sizes, spacing,
 * alignment and a thin rule under section headings.
 */
import type { CvTemplate } from "./index";

export interface TemplateStyle {
  /** Standard PDF fonts (never embedded, always extractable). */
  pdfFont: { regular: string; bold: string };
  /** A font every word processor has. */
  docxFont: string;
  /** Sizes in points. */
  size: { name: number; headline: number; heading: number; body: number };
  /** Space before a section heading and after a paragraph, in points. */
  space: { beforeHeading: number; afterLine: number };
  /** Where the name, headline and contact line sit. */
  headerAlign: "left" | "center";
  /** Colour of section headings, as hex without '#'. Dark enough for any printer. */
  headingColor: string;
  /** A thin line under each section heading. */
  headingRule: boolean;
}

export const TEMPLATE_STYLES: Record<CvTemplate, TemplateStyle> = {
  classic: {
    pdfFont: { regular: "Times-Roman", bold: "Times-Bold" },
    docxFont: "Times New Roman",
    size: { name: 20, headline: 13, heading: 13, body: 11 },
    space: { beforeHeading: 14, afterLine: 4 },
    headerAlign: "center",
    headingColor: "000000",
    headingRule: true,
  },
  modern: {
    pdfFont: { regular: "Helvetica", bold: "Helvetica-Bold" },
    docxFont: "Arial",
    size: { name: 22, headline: 13, heading: 13, body: 10.5 },
    space: { beforeHeading: 16, afterLine: 4 },
    headerAlign: "left",
    headingColor: "1F3A5F",
    headingRule: false,
  },
  compact: {
    pdfFont: { regular: "Helvetica", bold: "Helvetica-Bold" },
    docxFont: "Arial",
    size: { name: 16, headline: 11, heading: 11, body: 9.5 },
    space: { beforeHeading: 9, afterLine: 2 },
    headerAlign: "left",
    headingColor: "000000",
    headingRule: true,
  },
};
