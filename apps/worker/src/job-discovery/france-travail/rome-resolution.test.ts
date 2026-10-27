import { describe, expect, it } from "vitest";
import { resolveRome, type RomePrediction } from "./rome-resolution";

const NOW = new Date("2026-10-26T08:00:00Z");

/** ROMEO answering `answer` for every title, and the titles it was asked. */
function fakeRomeo(answer: RomePrediction) {
  const asked: string[] = [];
  return {
    asked,
    predict: async (title: string) => {
      asked.push(title);
      return answer;
    },
  };
}

describe("a Search Criteria title's ROME codes, for La Bonne Boite (#406)", () => {
  it("takes Jobbbox's own ROME table first, without asking ROMEO", async () => {
    const romeo = fakeRomeo({ ok: true, codes: ["Z9999"], calls: 1 });

    expect(await resolveRome("Directrice financière (H/F)", { romeo, now: NOW })).toEqual({ resolution: { by: "table", codes: ["M1205"] }, calls: 0 });
    expect(romeo.asked).toEqual([]);
  });

  it("asks ROMEO when the table knows no such job, and keeps its codes", async () => {
    const romeo = fakeRomeo({ ok: true, codes: ["H1206"], calls: 2 });

    expect(await resolveRome("Responsable bureau d'études mécaniques", { romeo, now: NOW })).toEqual({ resolution: { by: "romeo", codes: ["H1206"] }, calls: 2 });
    expect(romeo.asked).toEqual(["Responsable bureau d'études mécaniques"]);
  });

  it("falls back to La Bonne Boite's free-text job when ROMEO finds nothing sure enough", async () => {
    const romeo = fakeRomeo({ ok: true, codes: [], calls: 1 });

    expect(await resolveRome("Chef de projet tisserand", { romeo, now: NOW })).toEqual({ resolution: { by: "job", job: "Chef de projet tisserand" }, calls: 1 });
  });

  it("falls back to the free-text job when ROMEO is refused or down, and without ROMEO at all", async () => {
    const refused = fakeRomeo({ ok: false, reason: "refused", detail: "token refused (HTTP 400 invalid_scope)", calls: 1 });

    expect(await resolveRome("Chef de projet tisserand", { romeo: refused, now: NOW })).toEqual({ resolution: { by: "job", job: "Chef de projet tisserand" }, calls: 1 });
    expect(await resolveRome("Chef de projet tisserand", { romeo: null, now: NOW })).toEqual({ resolution: { by: "job", job: "Chef de projet tisserand" }, calls: 0 });
  });
});
