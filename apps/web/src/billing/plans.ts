/**
 * The Plan catalogue's table and its rules (ADR-0014 addendum #206), behind the
 * billing module: callers go through `createBilling(...)` (`plans`, `createPlan`,
 * `updatePlan`, `movePlan`), never through this file.
 *
 * A Plan has a permanent key, a name in each Interface Language, a rank (the order
 * of the plan comparison and of Upgrade Prompts), a status (offered or hidden), one
 * Stripe product (none for Free) and its Plan Features. Plans are never deleted:
 * hiding one replaces retiring it. Free is built in: rank 1, offered, no product.
 */
import { FREE_PLAN, PLAN_FEATURES, PLAN_STATUSES, type Plan, type PlanFeature, type PlanStatus } from "@jobhub/shared";
import { createI18n, SUPPORTED_LOCALES, type Locale } from "@jobhub/shared/i18n";
import type { Pool } from "pg";
import * as z from "zod";
import type { Queryable } from "../database/pool";

/** A Plan's name in each Interface Language. */
export type PlanName = Record<Locale, string>;

/** What an Administrator defines for a Plan. */
export interface PlanDefinition {
  /** Permanent: `candidate_plan` and `plan_quota` reference it. */
  key: Plan;
  name: PlanName;
  /** 1 for Free; a higher rank is a higher Plan. */
  rank: number;
  status: PlanStatus;
  /** The Stripe product whose prices are this Plan's (`prod_…`); null for Free, and for a paid Plan not yet tied to one. */
  stripeProductId: string | null;
  features: PlanFeature[];
}

/** The Plans Jobbbox starts with; their names are the Interface Language's. */
const STARTING_PLANS = [
  { key: FREE_PLAN, rank: 1, features: [] },
  { key: "standard", rank: 2, features: [] },
  { key: "premium", rank: 3, features: ["coachingSessionDiscount"] },
] as const satisfies readonly { key: string; rank: number; features: readonly PlanFeature[] }[];

/** A new Plan's key: lower case letters, digits and dashes, starting with a letter. */
export const PLAN_KEY = /^[a-z][a-z0-9-]{1,31}$/;

const MAX_NAME_LENGTH = 60;

/** Creates the `plan` table and the starting Plans. Run before `plan_quota` is created. Safe to run repeatedly. */
export async function migratePlans(database: Pool): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS plan (
      key text PRIMARY KEY CHECK (key ~ '${PLAN_KEY.source}'),
      name_fr text NOT NULL CHECK (btrim(name_fr) <> ''),
      name_en text NOT NULL CHECK (btrim(name_en) <> ''),
      rank integer NOT NULL CHECK (rank >= 1),
      status text NOT NULL CHECK (status IN (${PLAN_STATUSES.map((status) => `'${status}'`).join(", ")})),
      stripe_product_id text UNIQUE CHECK (stripe_product_id LIKE 'prod\\_%'),
      features text[] NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Deferrable so that two Plans can swap ranks in one statement.
      CONSTRAINT plan_rank_key UNIQUE (rank) DEFERRABLE INITIALLY IMMEDIATE,
      -- Free is built in: first, offered, never sold through Stripe; nothing else is ranked with it.
      CONSTRAINT plan_free_built_in CHECK (
        CASE WHEN key = '${FREE_PLAN}' THEN rank = 1 AND status = 'offered' AND stripe_product_id IS NULL ELSE rank > 1 END
      )
    );
  `);
  for (const plan of STARTING_PLANS) {
    const names = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, createI18n(locale).t(`billing.plans.${plan.key}`)])) as PlanName;
    await database.query(
      `INSERT INTO plan (key, name_fr, name_en, rank, status, features) VALUES ($1, $2, $3, $4, 'offered', $5)
       ON CONFLICT (key) DO NOTHING`,
      [plan.key, names.fr, names.en, plan.rank, plan.features],
    );
  }
}

interface PlanRow {
  key: string;
  name_fr: string;
  name_en: string;
  rank: number;
  status: PlanStatus;
  stripe_product_id: string | null;
  features: string[];
}

const COLUMNS = "key, name_fr, name_en, rank, status, stripe_product_id, features";

function planFrom(row: PlanRow): PlanDefinition {
  return {
    key: row.key,
    name: { fr: row.name_fr, en: row.name_en },
    rank: row.rank,
    status: row.status,
    stripeProductId: row.stripe_product_id,
    // In code order, and only the ones the code still knows.
    features: PLAN_FEATURES.filter((feature) => row.features.includes(feature)),
  };
}

/** Every Plan, lowest rank first. */
export async function listPlans(database: Queryable): Promise<PlanDefinition[]> {
  const { rows } = await database.query<PlanRow>(`SELECT ${COLUMNS} FROM plan ORDER BY rank`);
  return rows.map(planFrom);
}

/** One Plan; null when there is no such Plan. */
export async function findPlan(database: Queryable, key: string): Promise<PlanDefinition | null> {
  const { rows } = await database.query<PlanRow>(`SELECT ${COLUMNS} FROM plan WHERE key = $1`, [key]);
  return rows[0] ? planFrom(rows[0]) : null;
}

/** One Plan, locked for the rest of the transaction `within` runs; null when there is no such Plan. */
export async function lockedPlan(within: Queryable, key: string): Promise<PlanDefinition | null> {
  const { rows } = await within.query<PlanRow>(`SELECT ${COLUMNS} FROM plan WHERE key = $1 FOR UPDATE`, [key]);
  return rows[0] ? planFrom(rows[0]) : null;
}

/** Ties a paid Plan with no Stripe product yet to `product`, unless another Plan has it. */
export async function adoptProduct(database: Queryable, key: string, product: string): Promise<void> {
  await database.query(
    `UPDATE plan SET stripe_product_id = $2, updated_at = now()
     WHERE key = $1 AND key <> '${FREE_PLAN}' AND stripe_product_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM plan WHERE stripe_product_id = $2)`,
    [key, product],
  );
}

export async function insertPlan(within: Queryable, plan: PlanDefinition): Promise<void> {
  await within.query(`INSERT INTO plan (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
    plan.key,
    plan.name.fr,
    plan.name.en,
    plan.rank,
    plan.status,
    plan.stripeProductId,
    plan.features,
  ]);
}

export async function savePlan(within: Queryable, plan: PlanDefinition): Promise<void> {
  await within.query(
    `UPDATE plan SET name_fr = $2, name_en = $3, status = $4, stripe_product_id = $5, features = $6, updated_at = now() WHERE key = $1`,
    [plan.key, plan.name.fr, plan.name.en, plan.status, plan.stripeProductId, plan.features],
  );
}

/** Swaps the ranks of two Plans. */
export async function swapRanks(within: Queryable, a: PlanDefinition, b: PlanDefinition): Promise<void> {
  await within.query(
    `UPDATE plan SET rank = CASE key WHEN $1 THEN $4::integer ELSE $3::integer END, updated_at = now() WHERE key IN ($1, $2)`,
    [a.key, b.key, a.rank, b.rank],
  );
}

const name = z.string().trim().min(1).max(MAX_NAME_LENGTH);
const productId = z.string().trim();
const features = z
  .array(z.string())
  .default([])
  .transform((values, context) => {
    const unknown = values.filter((value) => !PLAN_FEATURES.includes(value as PlanFeature));
    if (unknown.length) context.addIssue({ code: "custom", message: `unknown Plan Features: ${unknown.join(", ")}` });
    return PLAN_FEATURES.filter((feature) => values.includes(feature));
  });

/** What creating a Plan takes, as submitted (untrusted). */
export const newPlanInput = z.object({
  key: z.string().trim(),
  name: z.object({ fr: name, en: name }),
  stripeProductId: productId,
  features,
});

/** What editing a Plan takes, as submitted (untrusted). Free's product must stay null. */
export const planChangeInput = z.object({
  name: z.object({ fr: name, en: name }),
  status: z.enum(PLAN_STATUSES),
  stripeProductId: productId.nullable().default(null),
  features,
});
