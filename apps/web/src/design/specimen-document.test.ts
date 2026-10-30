import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { specimenPdf } from "./specimen-document";

describe("the Viewer's specimen document (#468)", () => {
  it("is a CV of exactly two pages, named as a Candidate would name it", async () => {
    const file = await specimenPdf();
    expect(file.fileName).toBe("CV-Marie-Dupont.pdf");
    const pdf = await getDocumentProxy(file.bytes.slice());
    expect(pdf.numPages).toBe(2);
  });
});
