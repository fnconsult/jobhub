import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog, type MemoryUsageLog } from "@jobhub/ai/testing";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { askForTailoredCv } from "./reply";

const CV_TEXT = "Consolidation IFRS de 12 filiales chez Groupe Seb.";
const VALID = JSON.stringify({ headline: "Directrice administrative et financière", summary: CV_TEXT, missing: [] });
const PROSE = `Voici le CV adapté : il met en avant ${CV_TEXT} J'espère qu'il vous plaira.`;
const TRUNCATED = VALID.slice(0, 40);

describe("asking the AI Coach for a Tailored CV", () => {
  let replies: string[];
  let usage: MemoryUsageLog;
  let warn: MockInstance<typeof console.warn>;
  const provider = () => createFakeProvider({ id: "mistral", reply: () => replies.shift() ?? "" });

  async function ask() {
    const fake = provider();
    usage = createMemoryUsageLog();
    const ai = createAiLayer({ providers: [fake], routes: { writing: "mistral" }, usage });
    const reply = await askForTailoredCv(ai, { task: "writing", candidateId: "c1", system: "system", prompt: `CV : ${CV_TEXT}` });
    return { reply, calls: fake.calls.length };
  }
  const warnings = () => warn.mock.calls.map((args) => args.map(String).join(" "));

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    ["wrapped in prose", PROSE, "no_json"],
    ["truncated", TRUNCATED, "no_json"],
  ])("a reply %s logs why it was refused and is asked for exactly once more", async (_, refused, reason) => {
    replies = [refused, refused, VALID];

    const { calls } = await ask();

    expect(calls).toBe(2);
    expect(warnings()[0]).toContain(reason);
    expect(warnings()[0]).toContain(`${refused.length}`);
    expect(warnings()[0]).toContain("mistral");
  });

  it("a valid reply on the retry is the proposal", async () => {
    replies = [PROSE, VALID];

    const { reply, calls } = await ask();

    expect(calls).toBe(2);
    expect(reply).toMatchObject({ headline: "Directrice administrative et financière", summary: CV_TEXT });
    expect(usage.entries).toHaveLength(2);
  });

  it("two refused replies are no proposal, with two warnings", async () => {
    replies = [PROSE, TRUNCATED, VALID];

    const { reply, calls } = await ask();

    expect(reply).toBeNull();
    expect(calls).toBe(2);
    expect(warnings()).toHaveLength(2);
    expect(usage.entries).toHaveLength(2);
  });

  it("a valid first reply is asked for once, with no warning", async () => {
    replies = [VALID];

    const { reply, calls } = await ask();

    expect(reply).toMatchObject({ headline: "Directrice administrative et financière" });
    expect(calls).toBe(1);
    expect(warnings()).toEqual([]);
  });

  it.each([
    ["no JSON object", "Désolé, je ne peux pas.", "no_json"],
    ["a JSON object that does not parse", `{"headline": "${CV_TEXT}", }`, "bad_json"],
    ["no CV section", JSON.stringify({ missing: ["Power BI"] }), "no_cv"],
    ["every section of the wrong shape", JSON.stringify({ headline: 12, experience: CV_TEXT, skills: { ifrs: true } }), "no_cv"],
  ])("a reply with %s is refused, and the warning tells why", async (_, refused, reason) => {
    replies = [refused, refused];

    await ask();

    expect(warnings()).toHaveLength(2);
    for (const warning of warnings()) expect(warning).toContain(`reason=${reason}`);
  });

  it("no warning holds the CV or the Job Offer", async () => {
    replies = [PROSE, `{"headline": "${CV_TEXT}", }`];

    await ask();

    expect(warnings()).toHaveLength(2);
    for (const warning of warnings()) {
      expect(warning).not.toContain("IFRS");
      expect(warning).not.toContain("Groupe Seb");
    }
  });
});
