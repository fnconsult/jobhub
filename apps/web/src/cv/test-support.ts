/**
 * Builds real CV files from lines of text, so tests read like the CV they use:
 * a one-page PDF (Helvetica, WinAnsi, accents included) and a minimal DOCX,
 * either with a picture on it when a test needs one.
 * Also used by the e2e suite to upload CVs.
 */
import JSZip from "jszip";

/** A picture drawn on a CV, its size in pixels. */
export interface CvPicture {
  width: number;
  height: number;
}

/** A one-page PDF whose text is `lines`, one per line, with `picture` drawn top right when given. */
export function pdfCv(lines: string[], { picture }: { picture?: CvPicture } = {}): Uint8Array {
  // Helvetica with WinAnsiEncoding: Latin-1, plus a few Windows-1252 punctuation marks.
  const winAnsi: Record<string, string> = { "—": "\x97", "–": "\x96", "’": "\x92", "•": "\x95", "€": "\x80" };
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[—–’•€]/g, (c) => winAnsi[c]!);
  const text = ["BT", "/F1 10 Tf", "14 TL", "40 800 Td", ...lines.map((line) => `(${escape(line)}) Tj T*`), "ET"];
  const content = (picture ? ["q 90 0 0 110 465 712 cm /Im1 Do Q", ...text] : text).join("\n");
  const xObjects = picture ? " /XObject << /Im1 6 0 R >>" : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >>${xObjects} >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  if (picture) {
    // A plain grey picture, uncompressed: one byte per pixel.
    const pixels = "\x80".repeat(picture.width * picture.height);
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/** A Word (.docx) document with one paragraph per line, and a picture in it when `photo` is set. */
export async function docxCv(lines: string[], { photo = false }: { photo?: boolean } = {}): Promise<Uint8Array> {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const paragraphs = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
  );
  if (photo) {
    // A 1×1 PNG: Word keeps every picture of a document under word/media/.
    zip.file("word/media/image1.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64"));
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
    );
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** A typical French senior CV, as lines of text. */
export const MARIE_DUPONT_CV = [
  "Marie Dupont",
  "Directrice financière",
  "marie.dupont@example.fr · 06 12 34 56 78",
  "Lyon (69003)",
  "Profil",
  "Directrice financière, 25 ans d'expérience dans l'industrie.",
  "Expérience professionnelle",
  "Directrice financière — Groupe Seb, Lyon — 2015 – 2024",
  "Pilotage financier d'un groupe de 2 000 personnes.",
  "Responsable du contrôle de gestion — Renault, Paris — 2005 – 2015",
  "Mise en place du reporting mensuel.",
  "Formation",
  "Master Finance — ESSEC — 1998",
  "Compétences",
  "Consolidation, IFRS, SAP, Management d'équipe",
  "Langues",
  "Anglais : courant",
  "Allemand : notions",
];
