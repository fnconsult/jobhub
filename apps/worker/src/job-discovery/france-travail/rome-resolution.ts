/**
 * What La Bonne Boite is asked for a Search Criteria title (#406): its ROME codes, found the
 * cheapest sure way first.
 *
 *   await resolveRome("Directrice financière", { romeo, now }); // { resolution: { by: "table", codes: ["M1205"] }, calls: 0 }
 *
 * 1. Jobbbox's own ROME table (./rome.ts): free and deterministic.
 * 2. ROMEO's prediction (France Travail's AI matching a title to ROME jobs), when the table knows
 *    no such job: its codes scored sure enough (see ./romeo.ts).
 * 3. Else the title itself, as La Bonne Boite's free-text `job`, which it matches to ROME, NAF and
 *    domain labels on its side.
 *
 * Only the title leaves (ADR-0007). Never throws: ROMEO refused or down is step 3.
 */
import { romeCodesFor } from "./rome";

/** How a title is searched for at La Bonne Boite: by ROME codes (and where they came from), or as free text. */
export type RomeResolution = { by: "table" | "romeo"; codes: string[] } | { by: "job"; job: string };

/** ROMEO's answer for one title: the ROME codes it is sure enough of (maybe none), or why it could not answer. */
export type RomePrediction = { ok: true; codes: string[]; calls: number } | { ok: false; reason: "refused" | "failed"; detail: string; calls: number };

/** What resolving needs of ROMEO. */
export interface RomePredictor {
  predict(title: string, now: Date): Promise<RomePrediction>;
}

/** The ROME codes of `title` (or the title as free text), and how many HTTP calls ROMEO took. */
export async function resolveRome(title: string, { romeo, now }: { romeo: RomePredictor | null; now: Date }): Promise<{ resolution: RomeResolution; calls: number }> {
  const known = romeCodesFor(title);
  if (known.length > 0) return { resolution: { by: "table", codes: known }, calls: 0 };
  const predicted = romeo ? await romeo.predict(title, now) : null;
  if (predicted?.ok && predicted.codes.length > 0) return { resolution: { by: "romeo", codes: predicted.codes }, calls: predicted.calls };
  return { resolution: { by: "job", job: title.trim() }, calls: predicted?.calls ?? 0 };
}
