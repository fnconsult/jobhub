import { createDocumentReader, type DocumentDevice, type TailoredDocument } from "./document-reader";

/** A device that keeps its downloads in a map, by where they land: what a test reads back is what the cache holds. */
function fakeDevice() {
  const cache = new Map<string, string>();
  const viewed: string[] = [];
  const device: DocumentDevice = {
    download: async (path, { folder, fileName }) => {
      const file = `cache/documents/${folder}/${fileName}`;
      cache.set(file, path);
      return file;
    },
    view: async (file) => void viewed.push(cache.get(file)!),
    shareFile: async () => {},
    shareText: async () => {},
  };
  return { device, cache, viewed };
}

const document = (applicationId: string, kind: TailoredDocument["kind"]): TailoredDocument => ({
  kind,
  language: "fr",
  updatedAt: "2026-10-01T09:00:00.000Z",
  downloads: { pdf: `/api/applications/${applicationId}/documents/${kind}.pdf`, docx: `/api/applications/${applicationId}/documents/${kind}.docx` },
  message: null,
});

/** The same Job Offer, applied to under two Profiles: two Applications named alike. */
const NAME = { name: "CV adapté", about: "Aéroline · Responsable qualité" };

describe("the Tailored Documents' files on the device (#756)", () => {
  it("keeps each Application's documents in a file of their own, named for the Application, the document and its format", async () => {
    const { device, cache, viewed } = fakeDevice();
    const reader = createDocumentReader(device);

    await reader.read(document("app_1", "tailored_cv"), { ...NAME, applicationId: "app_1" });
    await reader.read(document("app_2", "tailored_cv"), { ...NAME, applicationId: "app_2" });
    await reader.read(document("app_1", "tailored_cv"), { ...NAME, applicationId: "app_1" });
    await reader.download(document("app_1", "cover_letter"), { name: "Lettre de motivation", about: NAME.about, applicationId: "app_1" }, "docx");

    expect([...cache.keys()]).toEqual([
      "cache/documents/app_1-tailored_cv/CV adapté – Aéroline · Responsable qualité.pdf",
      "cache/documents/app_2-tailored_cv/CV adapté – Aéroline · Responsable qualité.pdf",
      "cache/documents/app_1-cover_letter/Lettre de motivation – Aéroline · Responsable qualité.docx",
    ]);
    // Each read shows its own Application's document, the first again after the second.
    expect(viewed).toEqual(["/api/applications/app_1/documents/tailored_cv.pdf", "/api/applications/app_2/documents/tailored_cv.pdf", "/api/applications/app_1/documents/tailored_cv.pdf"]);
  });

  it("names the folder with nothing the device would read as a path", async () => {
    const { device, cache } = fakeDevice();

    await createDocumentReader(device).read(document("../app:1", "tailored_cv"), { name: "CV adapté", about: "A/B", applicationId: "../app:1" });

    expect([...cache.keys()]).toEqual(["cache/documents/..-app-1-tailored_cv/CV adapté – A-B.pdf"]);
  });
});
