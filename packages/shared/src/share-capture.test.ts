import { describe, expect, it } from "vitest";
import { readShareLink, SHARE_PATH, shareCaptureAnswerSchema, shareLink } from "./share-capture";

describe("the link the share sheet opens the Jobbbox app with (Share capture, #697)", () => {
  it("carries the link and the text shared, read back as they were", () => {
    const shared = { url: "https://carrieres.example.fr/offres/daf?ref=a&b=1", text: "Regarde : « DAF H/F » & co\nhttps://carrieres.example.fr/offres/daf" };
    const link = shareLink(shared);
    expect(link.startsWith(`jobbbox://${SHARE_PATH.slice(1)}?`)).toBe(true);
    expect(readShareLink(link)).toEqual(shared);
  });

  it("carries either alone", () => {
    expect(readShareLink(shareLink({ url: "https://exemple.fr/1" }))).toEqual({ url: "https://exemple.fr/1" });
    expect(readShareLink(shareLink({ text: "Le texte de l'offre" }))).toEqual({ text: "Le texte de l'offre" });
  });

  it("is read whichever way the system writes the scheme's address, and from Expo Router's own path", () => {
    expect(readShareLink("jobbbox:///partage?text=Bonjour")).toEqual({ text: "Bonjour" });
    expect(readShareLink("/partage?url=https%3A%2F%2Fexemple.fr%2F1")).toEqual({ url: "https://exemple.fr/1" });
  });

  it.each([[null], [""], ["jobbbox://connexion/fournisseur?cookie=x"], ["https://jobbbox.ai/partage?text=x"], ["jobbbox://partage"], ["jobbbox://partage?url=&text=%20"], ["pas un lien"]])(
    "reads no share from %s",
    (link) => {
      expect(readShareLink(link)).toBeNull();
    },
  );
});

describe("what the web app answers a Share capture", () => {
  it("is the Private Job Offer and its conversation, or what the screen must ask", () => {
    expect(shareCaptureAnswerSchema.parse({ jobOffer: { id: "o1", title: "DAF H/F", employer: null }, conversation: { id: "c1", title: "DAF H/F" } })).toBeTruthy();
    expect(shareCaptureAnswerSchema.parse({ error: "text_needed", reason: "forbidden_site" })).toBeTruthy();
    expect(shareCaptureAnswerSchema.safeParse({ error: "text_needed", reason: "other" }).success).toBe(false);
  });
});
