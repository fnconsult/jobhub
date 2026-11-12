import type { Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { creationOnPage, nextCreation, type CreationNote } from "./creation";

const at = (hhmm: string) => `2026-11-08T${hhmm}:00.000Z`;
const reading: Provenance = { v: 1, steps: [], sites: [], startedAt: at("10:31"), wallMs: 27_000 };

/** The notes, each at its time, from nothing known. */
const replay = (notes: [CreationNote, string][]) => notes.reduce((was, [note, when]) => nextCreation(was, note, when), nextCreation(null, { type: "started" }, at("10:30")));

describe("what the browser knows of a Profile's creation (#810), never kept", () => {
  it("knows nothing as the Candidate starts, nor after « Recommencer »", () => {
    expect(nextCreation(null, { type: "started" }, at("10:30"))).toEqual({});
    expect(replay([[{ type: "read", provenance: reading }, at("10:32")], [{ type: "started" }, at("10:33")]])).toEqual({});
  });

  it("knows the CV read with its Provenance, the review once opened (when first), and the Profile's page once saved", () => {
    expect(
      replay([
        [{ type: "read", provenance: reading }, at("10:32")],
        [{ type: "reviewed" }, at("10:32")],
        [{ type: "reviewed" }, at("10:35")],
        [{ type: "saved", href: "/profils/p" }, at("10:38")],
      ]),
    ).toEqual({ reading: { provenance: reading }, review: { at: at("10:32") }, href: "/profils/p" });
  });

  it("knows the Profile born during the questionnaire (#999), when first, and still shows on `/profils/nouveau` only", () => {
    const born = replay([
      [{ type: "answered", answered: 3, skipped: 0 }, at("10:31")],
      [{ type: "created", href: "/profils/p/versions/1" }, at("10:32")],
      [{ type: "created", href: "/profils/q/versions/1" }, at("10:33")],
    ]);
    expect(born).toEqual({ questionnaire: { at: at("10:31"), answered: 3, skipped: 0 }, created: { at: at("10:32"), href: "/profils/p/versions/1" } });
    expect(creationOnPage(born, "/")).toBeUndefined();
  });

  it("knows each rewritten summary the AI translated (#1005), from the first, their steps and times together", () => {
    const first: Provenance = { v: 1, steps: [], sites: [{ kind: "candidate", links: [] }], startedAt: at("10:40"), wallMs: 900 };
    const second: Provenance = { ...first, startedAt: at("10:42"), wallMs: 1_100 };
    expect(
      replay([
        [{ type: "summaryChanged", provenance: first }, at("10:40")],
        [{ type: "summaryChanged", provenance: null }, at("10:41")],
        [{ type: "summaryChanged", provenance: second }, at("10:42")],
      ]),
    ).toEqual({ summaryChanges: { at: at("10:40"), provenance: { ...first, sites: [...first.sites, ...second.sites], wallMs: 2_000 } } });
  });

  it("counts the questionnaire's answers given and skipped, from when it started", () => {
    expect(
      replay([
        [{ type: "answered", answered: 0, skipped: 0 }, at("10:31")],
        [{ type: "answered", answered: 1, skipped: 0 }, at("10:32")],
        [{ type: "answered", answered: 2, skipped: 1 }, at("10:34")],
      ]),
    ).toEqual({ questionnaire: { at: at("10:31"), answered: 2, skipped: 1 } });
  });
});

describe("where it shows", () => {
  const unsaved = { review: { at: at("10:32") } };
  const saved = { ...unsaved, href: "/profils/p" };

  it("while not saved, on `/profils/nouveau` only", () => {
    expect(creationOnPage(unsaved, "/profils/nouveau")).toBe(unsaved);
    expect(creationOnPage(unsaved, "/")).toBeUndefined();
  });

  it("once saved, on every page: the builder adds it to that Profile's « Création du profil » only", () => {
    expect(creationOnPage(saved, "/profils/p/cv-de-reference")).toBe(saved);
    expect(creationOnPage(null, "/profils/nouveau")).toBeUndefined();
  });
});
