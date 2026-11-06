import { describe, expect, it } from "vitest";
import { cvFileProblem, MAX_CV_FILE_BYTES } from "./cv-file";

const MB = 1024 * 1024;

describe("a CV file, checked before it is sent (ADR-0068)", () => {
  it("may be up to 10 MB", () => {
    expect(MAX_CV_FILE_BYTES).toBe(10 * MB);
    expect(cvFileProblem({ name: "CV.pdf", size: 10 * MB })).toBeNull();
  });

  it("is refused above 10 MB", () => {
    expect(cvFileProblem({ name: "CV.pdf", size: 10 * MB + 1 })).toBe("too_large");
  });

  it("is a PDF or a Word file (.docx), whatever the case of its extension", () => {
    expect(cvFileProblem({ name: "Mon CV.DOCX", size: 200_000 })).toBeNull();
    expect(cvFileProblem({ name: "ancien.doc", size: 200_000 })).toBe("unsupported_format");
    expect(cvFileProblem({ name: "photo.jpg", size: 200_000 })).toBe("unsupported_format");
    expect(cvFileProblem({ name: "pdf", size: 200_000 })).toBe("unsupported_format");
  });

  it("names its format first: a film is not a CV, however large", () => {
    expect(cvFileProblem({ name: "film.mp4", size: 900 * MB })).toBe("unsupported_format");
  });
});
