import { describe, expect, it } from "vitest";
import { chooseFrame, choosePage, type FrameRead } from "./frame-choice";
import type { CapturedJobOffer } from "./job-page";

function jobOffer(url: string, title: string, content: string): CapturedJobOffer {
  return { source: { url }, title, content };
}

// The Région Île-de-France's career site: an empty shell, the posting in a gestmax.fr iframe (#187).
const shell: FrameRead = {
  frameId: 0,
  page: {
    detected: false,
    jobOffer: jobOffer(
      "https://www.iledefrance.fr/region-recrute#page-16624---1---un-chef-ou-une-cheffe-de-produit-data-et-pilotage?backlink=search",
      "Offres d'emploi et de stage de la Région Île-de-France",
      "Accueil\nRégion recrute",
    ),
  },
};
const postingFrame: FrameRead = {
  frameId: 3,
  page: {
    detected: true,
    jobOffer: jobOffer(
      "https://iledefrance.gestmax.fr/16624/1/un-chef-ou-une-cheffe-de-produit-data-et-pilotage?backlink=search",
      "Un Chef ou une Cheffe de produit Data et Pilotage",
      "Au sein du pôle Données, vous pilotez les produits data de la Région.",
    ),
  },
};

describe("choosing the frame a Capture takes", () => {
  it("takes the posting in a child frame over the page around it, with the frame's own URL", () => {
    expect(chooseFrame([shell, postingFrame])).toBe(postingFrame.page?.jobOffer);
    // ...even when the page around it has nothing to capture at all.
    expect(chooseFrame([{ frameId: 0, page: { detected: false, jobOffer: null } }, postingFrame])).toBe(postingFrame.page?.jobOffer);
  });

  it("takes a frame where a posting is detected over one with more text", () => {
    const longPage: FrameRead = { frameId: 0, page: { detected: false, jobOffer: jobOffer("https://www.example.fr/", "Accueil", "x".repeat(10_000)) } };

    expect(chooseFrame([longPage, postingFrame])).toBe(postingFrame.page?.jobOffer);
  });

  it("otherwise takes the frame with the most text, and the page itself on a tie", () => {
    const page: FrameRead = { frameId: 0, page: { detected: false, jobOffer: jobOffer("https://www.example.fr/poste", "DAF", "Rattaché au DG.") } };
    const longer: FrameRead = { frameId: 2, page: { detected: false, jobOffer: jobOffer("https://ats.example.com/1", "DAF H/F", "Rattaché au DG, vous pilotez la finance.") } };
    const same: FrameRead = { frameId: 4, page: { detected: false, jobOffer: jobOffer("https://ats.example.com/2", "DAF", "Rattaché au DG.") } };

    expect(chooseFrame([page, longer])).toBe(longer.page?.jobOffer);
    expect(chooseFrame([same, page])).toBe(page.page?.jobOffer);
  });

  it("never takes a child frame that is not a web page of its own (an ad written into about:blank, say)", () => {
    const ad: FrameRead = { frameId: 5, page: { detected: false, jobOffer: jobOffer("about:blank", "Publicité", "x".repeat(10_000)) } };

    expect(chooseFrame([shell, ad])).toBe(shell.page?.jobOffer);
    expect(chooseFrame([ad])).toBeNull();
  });

  it("has nothing to capture when no frame has a Job Offer", () => {
    expect(chooseFrame([{ frameId: 0, page: null }, { frameId: 1, page: { detected: false, jobOffer: null } }])).toBeNull();
    expect(chooseFrame([])).toBeNull();
  });
});

describe("the page a tab shows, for the Side Panel's posting in view", () => {
  it("is the chosen frame's, saying whether a posting is detected there", () => {
    expect(choosePage([shell, postingFrame])).toEqual({ detected: true, jobOffer: postingFrame.page!.jobOffer });
    expect(choosePage([shell])).toEqual({ detected: false, jobOffer: shell.page!.jobOffer });
    expect(choosePage([{ frameId: 0, page: null }])).toBeNull();
  });
});
