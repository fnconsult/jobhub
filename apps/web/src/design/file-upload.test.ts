import { describe, expect, it } from "vitest";
import { fileKind, fileProblem, fileSize } from "./file-upload";

const CV = { maxBytes: 10 * 1024 * 1024, extensions: ["pdf", "docx"] };

describe("fileProblem (#468): what the File upload refuses before sending a file", () => {
  it("accepts a PDF or a Word file up to the limit, whatever the case of its extension", () => {
    expect(fileProblem({ name: "cv.pdf", size: 412_000 }, CV)).toBeNull();
    expect(fileProblem({ name: "CV-Marie.DOCX", size: 10 * 1024 * 1024 }, CV)).toBeNull();
  });

  it("refuses a file over the limit, by one byte", () => {
    expect(fileProblem({ name: "cv.pdf", size: 10 * 1024 * 1024 + 1 }, CV)).toBe("too_large");
  });

  it("refuses a file of another format, an old Word file among them", () => {
    expect(fileProblem({ name: "cv.doc", size: 1000 }, CV)).toBe("unsupported_format");
    expect(fileProblem({ name: "photo.png", size: 1000 }, CV)).toBe("unsupported_format");
    expect(fileProblem({ name: "cv", size: 1000 }, CV)).toBe("unsupported_format");
  });

  it("names the format first when a file is both too large and of another format", () => {
    expect(fileProblem({ name: "film.mov", size: 50 * 1024 * 1024 }, CV)).toBe("unsupported_format");
  });
});

describe("fileKind: the badge on a chosen file's row", () => {
  it("is PDF or DOCX from the extension, null for anything else", () => {
    expect(fileKind("CV-Francois-2026.pdf")).toBe("pdf");
    expect(fileKind("cv.Docx")).toBe("docx");
    expect(fileKind("notes.txt")).toBeNull();
  });
});

describe("fileSize: a file's size in words", () => {
  it("says kilobytes under a megabyte and megabytes above, in the reader's language", () => {
    expect(fileSize(412_000, "fr")).toBe("402 Ko");
    expect(fileSize(412_000, "en")).toBe("402 KB");
    expect(fileSize(3_500_000, "fr")).toBe("3,3 Mo");
    expect(fileSize(3_500_000, "en")).toBe("3.3 MB");
  });

  it("says at least 1 kilobyte for a tiny file", () => {
    expect(fileSize(12, "fr")).toBe("1 Ko");
  });
});
