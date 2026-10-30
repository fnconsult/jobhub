import { describe, expect, it } from "vitest";
import { nouveautes, releaseNotes, type ReleaseNote } from "./index";

const note = (version: string): ReleaseNote => ({
  version,
  locale: "fr",
  date: "2026-11-01",
  title: `Version ${version}`,
  tags: ["candidature"],
  image: null,
  announce: false,
  intro: "Ce qui change.",
  changes: [],
});

const versions = (notes: readonly ReleaseNote[]) => notes.map((entry) => entry.version);

describe("nouveautes — the Release Notes a deployment shows", () => {
  const notes = [note("0.2.0"), note("0.10.0"), note("0.1.0"), note("0.9.1")];

  it("lists them newest first, by Version, not as text", () => {
    expect(versions(nouveautes(notes, { version: "0.10.0", beta: false }).published)).toEqual(["0.10.0", "0.9.1", "0.2.0", "0.1.0"]);
  });

  it("in production, publishes the note of the Version it serves, and has no Beta block", () => {
    const shown = nouveautes(notes, { version: "0.10.0", beta: false });
    expect(shown.beta).toBeNull();
    expect(versions(shown.published)[0]).toBe("0.10.0");
  });

  it("on the Beta, shows the next Version's note apart, not yet published", () => {
    const shown = nouveautes(notes, { version: "0.10.0", beta: true });
    expect(shown.beta?.version).toBe("0.10.0");
    expect(versions(shown.published)).toEqual(["0.9.1", "0.2.0", "0.1.0"]);
  });

  it("on the Beta of a Version with no note yet, has no Beta block", () => {
    const shown = nouveautes(notes, { version: "0.11.0", beta: true });
    expect(shown.beta).toBeNull();
    expect(versions(shown.published)).toEqual(["0.10.0", "0.9.1", "0.2.0", "0.1.0"]);
  });

  it("never shows the note of a Version later than the one it serves", () => {
    expect(versions(nouveautes(notes, { version: "0.9.1", beta: false }).published)).toEqual(["0.9.1", "0.2.0", "0.1.0"]);
    expect(nouveautes(notes, { version: "0.9.1", beta: true }).beta?.version).toBe("0.9.1");
  });

  it("publishes every note when the Version it serves is not known", () => {
    expect(versions(nouveautes(notes, { version: null, beta: true }).published)).toEqual(["0.10.0", "0.9.1", "0.2.0", "0.1.0"]);
  });

  it("shows that nothing is published when there is no note", () => {
    expect(nouveautes([], { version: "0.1.0", beta: true })).toEqual({ beta: null, published: [] });
  });
});

describe("releaseNotes — the Release Notes this package was built with", () => {
  it("are in the language asked for", () => {
    expect(releaseNotes("en").every((entry) => entry.locale === "en")).toBe(true);
    expect(versions(releaseNotes("en"))).toEqual(versions(releaseNotes("fr")));
  });
});
