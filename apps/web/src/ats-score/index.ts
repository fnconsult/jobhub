/**
 * ATS Scoring: the ATS Score of a Profile's Master CV, and the ATS Fixes the
 * AI Coach proposes for it as Action Cards.
 *
 * `createAtsScoring({ database, profiles, actionCards, atsScoreQuota })` gives:
 *  - `analyse(candidateId, profileId, locale)` — scores the current Master CV
 *    against the Profile's target role (counted against the Plan Quota, asked
 *    first), keeps the score for the Profile page and proposes each ATS Fix as
 *    an "ats_fix" Action Card on the Profile, written in `locale`. A fix already
 *    pending, or one the Candidate dismissed there, is not proposed again.
 *  - `latest(candidateId, profileId)` — the score last kept, and the Master CV
 *    version it was computed on; null before the first analysis.
 *  - `acceptFix(card, candidateId)` — the Action Cards' handler for "ats_fix":
 *    applies the fix to the current Master CV as a new version, then recomputes
 *    the score (not counted). Throws, so the card stays pending, when the fix no
 *    longer applies to the Master CV.
 *  - `migrateAtsScores(database)` — creates / upgrades the table. Run after Profiles.
 * Problems come back as results, never exceptions (but for `acceptFix`).
 * Both are Jobbbox's rules on the Master CV, no AI (#336): an ATS Score's Provenance
 * is a fixed rules step, read from when it was computed (its time not measured), and
 * each ATS Fix card keeps the timed rules step that proposed it.
 */
import { byRules, applyAtsFix, proposeAtsFixes, rulesProvenance, scoreAts, type AtsFix, type AtsScore, type Provenance } from "@jobhub/shared";
import type { Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import type { ActionCard, ActionCards } from "../action-cards";
import type { QuotaDecision } from "../billing";
import type { QuotaRefusal } from "../billing/upgrade-prompt";
import type { Profile, Profiles } from "../profiles";
import { routes } from "../routes";
import { cardText } from "./card-text";

/** The kind of Action Card an ATS Fix is proposed as. */
export const ATS_FIX_CARD = "ats_fix";

/** What an "ats_fix" Action Card carries. */
export interface AtsFixPayload {
  fix: AtsFix;
}

export interface KeptAtsScore {
  /** The Master CV version scored. */
  version: number;
  score: AtsScore;
  computedAt: Date;
  /** Jobbbox's rules on the Master CV: « Calcul », no model. */
  provenance: Provenance;
}

export type AnalyseResult =
  | { ok: true; atsScore: KeptAtsScore }
  /** No such Profile for this Candidate. */
  | { ok: false; error: "not_found" }
  /** The Candidate's Plan Quota allows no more ATS Scores this week. */
  | { ok: false; error: "quota_exceeded"; refusal: QuotaRefusal };

/** Records one ATS Score for the Candidate if their Plan allows it (billing's `use(candidateId, "atsScores")`). */
export type AtsScoreQuota = (candidateId: string) => Promise<QuotaDecision>;

export interface AtsScoring {
  analyse(candidateId: string, profileId: string, locale: Locale): Promise<AnalyseResult>;
  latest(candidateId: string, profileId: string): Promise<KeptAtsScore | null>;
  acceptFix(card: ActionCard, candidateId: string): Promise<void>;
}

/** The ATS Fix an Action Card carries, or undefined for any other card. */
export function atsFixOf(card: Pick<ActionCard, "kind" | "payload">): AtsFix | undefined {
  if (card.kind !== ATS_FIX_CARD) return undefined;
  const fix = (card.payload as Partial<AtsFixPayload> | null)?.fix;
  return fix && typeof fix.id === "string" && typeof fix.change?.type === "string" ? fix : undefined;
}

/**
 * Two ATS Fixes are the same proposal when they make the same change for the same reason.
 * A fix read back from a card went through jsonb, which reorders object keys, so the key
 * is built with every object's keys sorted: only what the fix says counts, not its key order.
 */
function sameFix({ id, category, reason, change }: AtsFix): string {
  return canonicalJson([id, category, reason, change]);
}

/** JSON whose objects list their keys in sorted order, at every depth. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, part: unknown) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : part,
  );
}

/** The Candidate's page the ATS Score and Fixes are worked out from: the Profile's Master CV. */
const masterCvPage = (profileId: string) => routes.profileSection(profileId, "cv-de-reference");

/** An ATS Score's Provenance: a fixed rules step on the Master CV, when it was computed. */
const scoreProvenance = (profileId: string, computedAt: Date): Provenance => rulesProvenance("ats_score", { at: computedAt, links: [masterCvPage(profileId)] });

/** A save that lost the race to another one is tried again on top of it, this many times. */
const SAVE_ATTEMPTS = 3;

export function createAtsScoring({
  database,
  profiles,
  actionCards,
  atsScoreQuota = async () => ({ allowed: true, remaining: null }),
  now = () => new Date(),
}: {
  database: Pool;
  profiles: Profiles;
  actionCards: ActionCards;
  atsScoreQuota?: AtsScoreQuota;
  now?: () => Date;
}): AtsScoring {
  async function keep(profile: Profile): Promise<KeptAtsScore> {
    const computedAt = now();
    const kept: KeptAtsScore = {
      version: profile.masterCv.version,
      score: scoreAts({ cv: profile.masterCv.content, targetRole: profile.searchCriteria.targetRole }),
      computedAt,
      provenance: scoreProvenance(profile.id, computedAt),
    };
    await database.query(
      `INSERT INTO ats_score (profile_id, version, score, computed_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (profile_id) DO UPDATE SET version = EXCLUDED.version, score = EXCLUDED.score, computed_at = EXCLUDED.computed_at`,
      [profile.id, kept.version, kept.score, kept.computedAt],
    );
    return kept;
  }

  async function propose(candidateId: string, profile: Profile, locale: Locale) {
    const focus = { kind: "profile", id: profile.id } as const;
    const cv = profile.masterCv.content;
    const { value: fixes, provenance } = await byRules("ats_fixes", () => proposeAtsFixes({ cv, targetRole: profile.searchCriteria.targetRole, today: now() }), {
      now,
      links: [masterCvPage(profile.id)],
    });
    const proposed = new Set(fixes.map(sameFix));
    // A pending fix the new score no longer calls for, or calls for differently, is taken back.
    const pending: string[] = [];
    for (const card of await actionCards.pending(candidateId, focus)) {
      const fix = atsFixOf(card);
      if (!fix) continue;
      if (proposed.has(sameFix(fix))) pending.push(fix.id);
      else await actionCards.withdraw(candidateId, card.id);
    }
    const dismissed = (await actionCards.dismissed(candidateId, focus)).map((card) => atsFixOf(card)?.id);
    const known = new Set([...pending, ...dismissed].filter(Boolean));
    for (const fix of fixes) {
      if (known.has(fix.id)) continue;
      const payload: AtsFixPayload = { fix };
      await actionCards.propose(candidateId, { kind: ATS_FIX_CARD, focus, payload, provenance, ...cardText(fix, cv, locale) });
    }
  }

  return {
    async analyse(candidateId, profileId, locale) {
      const profile = await profiles.get(candidateId, profileId);
      if (!profile) return { ok: false, error: "not_found" };
      const decision = await atsScoreQuota(candidateId);
      if (!decision.allowed) return { ok: false, error: "quota_exceeded", refusal: decision };
      const atsScore = await keep(profile);
      await propose(candidateId, profile, locale);
      return { ok: true, atsScore };
    },

    async latest(candidateId, profileId) {
      if (!(await profiles.get(candidateId, profileId))) return null;
      const { rows } = await database.query<{ version: number; score: AtsScore; computed_at: Date }>(
        `SELECT version, score, computed_at FROM ats_score WHERE profile_id = $1`,
        [profileId],
      );
      const row = rows[0];
      return row ? { version: row.version, score: row.score, computedAt: row.computed_at, provenance: scoreProvenance(profileId, row.computed_at) } : null;
    },

    async acceptFix(card, candidateId) {
      const fix = atsFixOf(card);
      if (!fix || card.focus.kind !== "profile") throw new Error("not an ATS Fix card");
      for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
        const profile = await profiles.get(candidateId, card.focus.id);
        if (!profile) throw new Error("the Profile is gone");
        const content = applyAtsFix(profile.masterCv.content, fix);
        if (!content) throw new Error("the ATS Fix no longer applies to the Master CV");
        const saved = await profiles.saveMasterCv(candidateId, profile.id, { basedOnVersion: profile.masterCv.version, content });
        if (saved?.ok) {
          await keep(saved.profile);
          return;
        }
        if (!saved || !("conflict" in saved)) throw new Error("the fixed Master CV was refused");
      }
      throw new Error("the Master CV kept changing");
    },
  };
}

/** Creates or upgrades the ATS Score table. Run after the Profiles' migration. Safe to run repeatedly. */
export async function migrateAtsScores(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS ats_score (
      profile_id uuid PRIMARY KEY REFERENCES profile (id) ON DELETE CASCADE,
      version integer NOT NULL,
      score jsonb NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
