/**
 * Two-step verification (ADR-0075, #663): a second step after a magic-link sign-in, with a code from an authenticator
 * app or a backup code. A Candidate turns it on in Mon compte (« Sécurité ») and may turn it off.
 *
 *   const twoStep = createTwoStepVerification(pool, { secret: AUTH_SECRET });
 *   const { secret, uri } = await twoStep.startSetup(candidateId, email);    // the QR code and the key to type
 *   await twoStep.confirmSetup({ candidateId, sessionId }, code);            // on, with 10 backup codes shown once
 *   await twoStep.verify({ candidateId, sessionId }, code);                  // the second step: the session is no longer pending
 *
 * The app's secret is kept encrypted with AUTH_SECRET (Better Auth's own cipher, as its two-factor plugin does), the
 * backup codes only hashed: each code, of either kind, serves once. After MAX_FAILED_ATTEMPTS wrong codes in a row,
 * every code is refused for LOCK_MINUTES. Each attempt is counted under the Tool « Vérification en deux étapes »
 * (ExternalApiLog), never its code nor who made it.
 *
 * Whether a session is pending, and when its second step was last done, are columns of Better Auth's `session`
 * (auth/index.ts sets `twoStepPending` when a magic link signs in an account that has it): a success here clears
 * the one and dates the other.
 */
import { createHash, randomInt } from "node:crypto";
import type { ExternalApiLog } from "@jobhub/shared";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../database/pool";
import { newTotpSecret, totpUri, verifyTotp } from "./totp";

/** Wrong codes in a row before every code is refused for a while. */
export const MAX_FAILED_ATTEMPTS = 5;
/** How long every code is refused after MAX_FAILED_ATTEMPTS wrong ones. */
export const LOCK_MINUTES = 15;
/** How many backup codes are given at once. */
export const BACKUP_CODE_COUNT = 10;
/** How recent a second step must be to turn the verification off or renew the backup codes. */
export const RECENT_SECOND_STEP_MINUTES = 10;
/** The name the authenticator app shows the account under. */
const ISSUER = "Jobbbox";
const PROVIDER = "two_step_verification";

/** One way of doing the second step, as Mon compte and the Data export show it: never its secret. */
export interface TwoStepFactor {
  kind: "authenticator_app" | "backup_codes";
  addedAt: Date;
  lastUsedAt: Date | null;
}

export interface TwoStepStatus {
  /** When it was turned on; null while it is off. */
  enabledAt: Date | null;
  /** Empty while it is off. */
  factors: TwoStepFactor[];
  backupCodesLeft: number;
}

/** Who does the second step, and in which session. */
export interface SecondStepBy {
  candidateId: string;
  sessionId: string;
}

export type SecondStepResult =
  | { ok: true; factor: "authenticator_app" | "backup_code" }
  | { ok: false; error: "invalid_code" | "not_enabled" }
  | { ok: false; error: "locked"; retryAt: Date };

export type SetupResult = { ok: true; backupCodes: string[] } | { ok: false; error: "invalid_code" | "no_setup" | "already_enabled" };

export interface TwoStepVerification {
  isEnabled(candidateId: string): Promise<boolean>;
  status(candidateId: string): Promise<TwoStepStatus>;
  /**
   * Starts setting up an authenticator app, or starts again: a new secret, in base32 (the key to type) and in the
   * `otpauth://` address the QR code holds. Throws while the verification is on.
   */
  startSetup(candidateId: string, email: string): Promise<{ secret: string; uri: string }>;
  /** Turns it on with the app's first code, which counts as a second step done in `by.sessionId`: the backup codes, shown once. */
  confirmSetup(by: SecondStepBy, code: string): Promise<SetupResult>;
  /** The second step: an app's code or a backup code. Done, the session is no longer pending, and dated. */
  verify(by: SecondStepBy, code: string): Promise<SecondStepResult>;
  /** New backup codes, the old ones no longer working; null while it is off. */
  regenerateBackupCodes(candidateId: string): Promise<string[] | null>;
  /** Turns it off, forgetting the app and the codes, and signs out the sessions still pending. False when it was not on. */
  disable(candidateId: string): Promise<boolean>;
}

interface Row {
  totp_secret: string;
  enabled_at: Date | null;
  totp_last_step: string | null;
  backup_codes: string[];
  failed_attempts: number;
  locked_until: Date | null;
}

/** Whether a second step done at `verifiedAt` is recent enough to turn the verification off or renew the backup codes. */
export function isRecentSecondStep(verifiedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!verifiedAt) return false;
  const at = new Date(verifiedAt).getTime();
  return at <= now.getTime() && now.getTime() - at < RECENT_SECOND_STEP_MINUTES * 60_000;
}

/** The Candidate's Two-step verification as Mon compte and the Data export show it. */
export async function twoStepStatusOf(database: Pick<Pool, "query">, candidateId: string): Promise<TwoStepStatus> {
  const { rows } = await database.query<{
    enabled_at: Date;
    totp_added_at: Date;
    totp_last_used_at: Date | null;
    backup_codes_added_at: Date;
    backup_code_last_used_at: Date | null;
    left: number;
  }>(
    `SELECT enabled_at, totp_added_at, totp_last_used_at, backup_codes_added_at, backup_code_last_used_at, cardinality(backup_codes) AS left
       FROM two_step_verification WHERE candidate_id = $1 AND enabled_at IS NOT NULL`,
    [candidateId],
  );
  const row = rows[0];
  if (!row) return { enabledAt: null, factors: [], backupCodesLeft: 0 };
  return {
    enabledAt: row.enabled_at,
    factors: [
      { kind: "authenticator_app", addedAt: row.totp_added_at, lastUsedAt: row.totp_last_used_at },
      { kind: "backup_codes", addedAt: row.backup_codes_added_at, lastUsedAt: row.backup_code_last_used_at },
    ],
    backupCodesLeft: row.left,
  };
}

/** Whether the Candidate has Two-step verification on: a magic link then signs them into a pending session. */
export async function hasTwoStepVerification(database: Pick<Pool, "query">, candidateId: string): Promise<boolean> {
  const { rowCount } = await database.query(`SELECT 1 FROM two_step_verification WHERE candidate_id = $1 AND enabled_at IS NOT NULL`, [candidateId]);
  return (rowCount ?? 0) > 0;
}

/** A backup code as compared: lower case, without its hyphen or spaces. */
const normalisedBackupCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, "");
const hashed = (code: string) => createHash("sha256").update(normalisedBackupCode(code)).digest("hex");
const BACKUP_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODE_COUNT) {
    const raw = Array.from({ length: 10 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join("");
    codes.add(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return [...codes];
}

export function createTwoStepVerification(
  database: Pool,
  options: { secret: string; now?: () => Date; externalApis?: ExternalApiLog; clock?: () => number },
): TwoStepVerification {
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());

  /** Counts an attempt under the Tool: its outcome alone. */
  function record(operation: "setup" | "second_step", started: number, status: 200 | 401 | 429) {
    try {
      void Promise.resolve(
        options.externalApis?.record({ provider: PROVIDER, operation, at: now(), durationMs: Math.round(clock() - started), ok: status === 200, httpStatus: status, costEur: 0 }),
      ).catch((error: unknown) => console.warn("[two-step-verification] an attempt could not be counted", error));
    } catch (error) {
      console.warn("[two-step-verification] an attempt could not be counted", error);
    }
  }

  const lockedRow = async (client: PoolClient, candidateId: string) =>
    (
      await client.query<Row>(
        `SELECT totp_secret, enabled_at, totp_last_step, backup_codes, failed_attempts, locked_until FROM two_step_verification WHERE candidate_id = $1 FOR UPDATE`,
        [candidateId],
      )
    ).rows[0];

  const secondStepDone = (client: PoolClient, sessionId: string, at: Date) =>
    client.query(`UPDATE session SET "twoStepPending" = false, "twoStepVerifiedAt" = $2 WHERE id = $1`, [sessionId, at]);

  /** The app's secret; null when it no longer opens (AUTH_SECRET rotated): the backup codes still work then. */
  async function decrypt(data: string): Promise<string | null> {
    try {
      return await symmetricDecrypt({ key: options.secret, data });
    } catch (error) {
      console.error("[two-step-verification] an authenticator app's secret could not be decrypted", error);
      return null;
    }
  }

  return {
    isEnabled: (candidateId) => hasTwoStepVerification(database, candidateId),
    status: (candidateId) => twoStepStatusOf(database, candidateId),

    async startSetup(candidateId, email) {
      const secret = newTotpSecret();
      const sealed = await symmetricEncrypt({ key: options.secret, data: secret });
      const { rowCount } = await database.query(
        `INSERT INTO two_step_verification (candidate_id, totp_secret) VALUES ($1, $2)
         ON CONFLICT (candidate_id) DO UPDATE SET totp_secret = EXCLUDED.totp_secret WHERE two_step_verification.enabled_at IS NULL`,
        [candidateId, sealed],
      );
      if (!rowCount) throw new Error("Two-step verification is already on");
      return { secret, uri: totpUri(secret, { issuer: ISSUER, account: email }) };
    },

    async confirmSetup(by, code) {
      const started = clock();
      const result = await inTransaction(database, async (client): Promise<SetupResult> => {
        const row = await lockedRow(client, by.candidateId);
        if (!row) return { ok: false, error: "no_setup" };
        if (row.enabled_at) return { ok: false, error: "already_enabled" };
        const at = now();
        const secret = await decrypt(row.totp_secret);
        const step = secret === null ? null : verifyTotp(secret, code, at);
        if (step === null) return { ok: false, error: "invalid_code" };
        const backupCodes = newBackupCodes();
        await client.query(
          `UPDATE two_step_verification
              SET enabled_at = $2, totp_added_at = $2, totp_last_step = $3, backup_codes = $4, backup_codes_added_at = $2,
                  totp_last_used_at = NULL, backup_code_last_used_at = NULL, failed_attempts = 0, locked_until = NULL
            WHERE candidate_id = $1`,
          [by.candidateId, at, step, backupCodes.map(hashed)],
        );
        await secondStepDone(client, by.sessionId, at);
        return { ok: true, backupCodes };
      });
      if (result.ok || result.error === "invalid_code") record("setup", started, result.ok ? 200 : 401);
      return result;
    },

    async verify(by, code) {
      const started = clock();
      const result = await inTransaction(database, async (client): Promise<SecondStepResult> => {
        const row = await lockedRow(client, by.candidateId);
        if (!row?.enabled_at) return { ok: false, error: "not_enabled" };
        const at = now();
        if (row.locked_until && row.locked_until > at) return { ok: false, error: "locked", retryAt: row.locked_until };

        const secret = await decrypt(row.totp_secret);
        const step = secret === null ? null : verifyTotp(secret, code, at);
        // A code already used, or older than one used, is refused: each code serves once.
        if (step !== null && (row.totp_last_step === null || step > Number(row.totp_last_step))) {
          await client.query(
            `UPDATE two_step_verification SET totp_last_step = $2, totp_last_used_at = $3, failed_attempts = 0, locked_until = NULL WHERE candidate_id = $1`,
            [by.candidateId, step, at],
          );
          await secondStepDone(client, by.sessionId, at);
          return { ok: true, factor: "authenticator_app" };
        }
        const hash = hashed(code);
        if (normalisedBackupCode(code).length === 10 && row.backup_codes.includes(hash)) {
          await client.query(
            `UPDATE two_step_verification SET backup_codes = array_remove(backup_codes, $2), backup_code_last_used_at = $3, failed_attempts = 0, locked_until = NULL
              WHERE candidate_id = $1`,
            [by.candidateId, hash, at],
          );
          await secondStepDone(client, by.sessionId, at);
          return { ok: true, factor: "backup_code" };
        }

        if (row.failed_attempts + 1 >= MAX_FAILED_ATTEMPTS) {
          const retryAt = new Date(at.getTime() + LOCK_MINUTES * 60_000);
          await client.query(`UPDATE two_step_verification SET failed_attempts = 0, locked_until = $2 WHERE candidate_id = $1`, [by.candidateId, retryAt]);
          return { ok: false, error: "locked", retryAt };
        }
        await client.query(`UPDATE two_step_verification SET failed_attempts = failed_attempts + 1 WHERE candidate_id = $1`, [by.candidateId]);
        return { ok: false, error: "invalid_code" };
      });
      if (result.ok) record("second_step", started, 200);
      else if (result.error !== "not_enabled") record("second_step", started, result.error === "locked" ? 429 : 401);
      return result;
    },

    async regenerateBackupCodes(candidateId) {
      const backupCodes = newBackupCodes();
      const { rowCount } = await database.query(
        `UPDATE two_step_verification SET backup_codes = $2, backup_codes_added_at = $3, backup_code_last_used_at = NULL
          WHERE candidate_id = $1 AND enabled_at IS NOT NULL`,
        [candidateId, backupCodes.map(hashed), now()],
      );
      return rowCount ? backupCodes : null;
    },

    async disable(candidateId) {
      return inTransaction(database, async (client) => {
        const { rowCount } = await client.query(`DELETE FROM two_step_verification WHERE candidate_id = $1 AND enabled_at IS NOT NULL`, [candidateId]);
        // A session still waiting for its second step could never finish it: it is signed out.
        await client.query(`DELETE FROM session WHERE "userId" = $1 AND "twoStepPending"`, [candidateId]);
        return (rowCount ?? 0) > 0;
      });
    },
  };
}

/** Creates or upgrades the Two-step verification table. Run after the Candidate table. Safe to run repeatedly. */
export async function migrateTwoStepVerification(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS two_step_verification (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      -- The authenticator app's secret, encrypted with AUTH_SECRET; set up but not confirmed while enabled_at is null.
      totp_secret text NOT NULL,
      enabled_at timestamptz,
      totp_added_at timestamptz,
      totp_last_used_at timestamptz,
      -- The last 30-second period whose code was accepted: its code, and older ones, are refused.
      totp_last_step bigint,
      -- SHA-256 of each backup code not used yet.
      backup_codes text[] NOT NULL DEFAULT '{}',
      backup_codes_added_at timestamptz,
      backup_code_last_used_at timestamptz,
      failed_attempts integer NOT NULL DEFAULT 0,
      locked_until timestamptz
    )
  `);
}
