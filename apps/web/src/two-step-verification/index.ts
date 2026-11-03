/**
 * Two-step verification (ADR-0075, #663, #664): a second step after a magic-link sign-in, with a code from an
 * authenticator app, a passkey or a backup code. A Candidate turns it on in Mon compte (« Sécurité ») and may turn it off.
 *
 *   const twoStep = createTwoStepVerification(pool, { secret: AUTH_SECRET, relyingParty: relyingPartyOf(APP_URL) });
 *   const { secret, uri } = await twoStep.startSetup(candidateId, email);    // the QR code and the key to type
 *   await twoStep.confirmSetup({ candidateId, sessionId }, code);            // on, with 10 backup codes shown once
 *   await twoStep.enableWithPasskey({ candidateId, sessionId });             // or on with the passkeys just added
 *   await twoStep.verify({ candidateId, sessionId }, code);                  // the second step: the session is no longer pending
 *   await twoStep.verifyPasskey(by, answer);                                 // or with a passkey, to the challenge of passkeyChallenge(by)
 *
 * Passkeys are added, renamed and listed through Better Auth's passkey plugin (its `passkey` table, auth/index.ts);
 * removing one is `removePasskey`, the last factor taking the verification off with it.
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
import { checkedPasskey, credentialIdOf, deviceOf, passkeyRequest, type PasskeyRequest, type RelyingParty, type StoredPasskey } from "./passkeys";
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

/**
 * One way of doing the second step, as Mon compte and the Data export show it: never its secret nor a passkey's public
 * key. A passkey has its name (none when it was given none) and the device it was made with, when that is known.
 */
export type TwoStepFactor =
  | { kind: "authenticator_app" | "backup_codes"; addedAt: Date; lastUsedAt: Date | null }
  | { kind: "passkey"; id: string; name: string | null; device: string | null; addedAt: Date; lastUsedAt: Date | null };

export interface TwoStepStatus {
  /** When it was turned on; null while it is off. */
  enabledAt: Date | null;
  /**
   * The authenticator app, then the passkeys, oldest first, then the backup codes. While it is off, only passkeys left
   * by a setup that did not finish, if any.
   */
  factors: TwoStepFactor[];
  backupCodesLeft: number;
}

/** Who does the second step, and in which session. */
export interface SecondStepBy {
  candidateId: string;
  sessionId: string;
}

export type SecondStepResult =
  | { ok: true; factor: "authenticator_app" | "backup_code" | "passkey" }
  | { ok: false; error: "invalid_code" | "invalid_passkey" | "not_enabled" }
  | { ok: false; error: "locked"; retryAt: Date };

export type SetupResult = { ok: true; backupCodes: string[] } | { ok: false; error: "invalid_code" | "no_setup" | "no_passkey" | "already_enabled" };

/** Removing a passkey: the last factor takes the verification off with it, after a second step done less than 10 minutes ago. */
export type PasskeyRemoval = { ok: true; disabled: boolean } | { ok: false; error: "not_found" | "recent_second_step_required" };

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
  /**
   * Turns it on with the passkeys the Candidate has just added (one at least), which counts as a second step done in
   * `by.sessionId`: the backup codes, shown once, as with an app.
   */
  enableWithPasskey(by: SecondStepBy): Promise<SetupResult>;
  /** The second step: an app's code or a backup code. Done, the session is no longer pending, and dated. */
  verify(by: SecondStepBy, code: string): Promise<SecondStepResult>;
  /**
   * What the browser is asked to sign for a second step with a passkey, in `by.sessionId`: one of the Candidate's own
   * passkeys. Null when it is off or they have none. Each asks a new challenge, which serves one answer.
   */
  passkeyChallenge(by: SecondStepBy): Promise<PasskeyRequest | null>;
  /**
   * The second step with a passkey: the browser's answer to the session's last challenge. A passkey of another account,
   * or of none, is refused and the session stays pending; each refusal counts towards the lock, as a wrong code does.
   */
  verifyPasskey(by: SecondStepBy, answer: unknown): Promise<SecondStepResult>;
  /**
   * Removes one of the Candidate's passkeys. When it is their last factor (no app, no other passkey), the verification
   * is turned off with it, which takes a second step done less than 10 minutes ago (`secondStepAt`, the session's).
   */
  removePasskey(by: { candidateId: string; secondStepAt: Date | string | null | undefined }, passkeyId: string): Promise<PasskeyRemoval>;
  /** New backup codes, the old ones no longer working; null while it is off. */
  regenerateBackupCodes(candidateId: string): Promise<string[] | null>;
  /** Turns it off, forgetting the app, the passkeys and the codes, and signs out the sessions still pending. False when it was not on. */
  disable(candidateId: string): Promise<boolean>;
}

interface Row {
  /** Null when it was turned on with a passkey. */
  totp_secret: string | null;
  enabled_at: Date | null;
  totp_added_at: Date | null;
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
  const [{ rows }, { rows: passkeyRows }] = await Promise.all([
    database.query<{
      enabled_at: Date;
      totp_added_at: Date | null;
      totp_last_used_at: Date | null;
      backup_codes_added_at: Date;
      backup_code_last_used_at: Date | null;
      left: number;
    }>(
      `SELECT enabled_at, totp_added_at, totp_last_used_at, backup_codes_added_at, backup_code_last_used_at, cardinality(backup_codes) AS left
         FROM two_step_verification WHERE candidate_id = $1 AND enabled_at IS NOT NULL`,
      [candidateId],
    ),
    database.query<{ id: string; name: string | null; aaguid: string | null; createdAt: Date; lastUsedAt: Date | null }>(
      `SELECT id, name, aaguid, "createdAt", "lastUsedAt" FROM passkey WHERE "userId" = $1 ORDER BY "createdAt", id`,
      [candidateId],
    ),
  ]);
  const passkeys = passkeyRows.map(
    (passkey): TwoStepFactor => ({ kind: "passkey", id: passkey.id, name: passkey.name || null, device: deviceOf(passkey.aaguid), addedAt: passkey.createdAt, lastUsedAt: passkey.lastUsedAt }),
  );
  const row = rows[0];
  if (!row) return { enabledAt: null, factors: passkeys, backupCodesLeft: 0 };
  return {
    enabledAt: row.enabled_at,
    factors: [
      ...(row.totp_added_at ? [{ kind: "authenticator_app", addedAt: row.totp_added_at, lastUsedAt: row.totp_last_used_at } as const] : []),
      ...passkeys,
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
  options: {
    secret: string;
    /** Who passkeys are made for (relyingPartyOf(APP_URL)): needed for a second step with a passkey. */
    relyingParty?: RelyingParty;
    now?: () => Date;
    externalApis?: ExternalApiLog;
    clock?: () => number;
  },
): TwoStepVerification {
  const now = options.now ?? (() => new Date());
  const relyingParty = () => {
    if (!options.relyingParty) throw new Error("Two-step verification needs its relyingParty for passkeys");
    return options.relyingParty;
  };
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
        `SELECT totp_secret, enabled_at, totp_added_at, totp_last_step, backup_codes, failed_attempts, locked_until FROM two_step_verification WHERE candidate_id = $1 FOR UPDATE`,
        [candidateId],
      )
    ).rows[0];

  /** A wrong code or passkey: counted, and every second step refused for LOCK_MINUTES after MAX_FAILED_ATTEMPTS in a row. */
  async function failed(client: PoolClient, candidateId: string, row: Row, at: Date, error: "invalid_code" | "invalid_passkey"): Promise<SecondStepResult> {
    if (row.failed_attempts + 1 >= MAX_FAILED_ATTEMPTS) {
      const retryAt = new Date(at.getTime() + LOCK_MINUTES * 60_000);
      await client.query(`UPDATE two_step_verification SET failed_attempts = 0, locked_until = $2 WHERE candidate_id = $1`, [candidateId, retryAt]);
      return { ok: false, error: "locked", retryAt };
    }
    await client.query(`UPDATE two_step_verification SET failed_attempts = failed_attempts + 1 WHERE candidate_id = $1`, [candidateId]);
    return { ok: false, error };
  }

  function recordSecondStep(started: number, result: SecondStepResult) {
    if (result.ok) record("second_step", started, 200);
    else if (result.error !== "not_enabled") record("second_step", started, result.error === "locked" ? 429 : 401);
  }

  /** Turns it off: the app, the passkeys and the codes forgotten, the sessions still pending signed out. False when it was not on. */
  async function turnOff(client: PoolClient, candidateId: string): Promise<boolean> {
    const { rowCount } = await client.query(`DELETE FROM two_step_verification WHERE candidate_id = $1 AND enabled_at IS NOT NULL`, [candidateId]);
    await client.query(`DELETE FROM passkey WHERE "userId" = $1`, [candidateId]);
    // A session still waiting for its second step could never finish it: it is signed out.
    await client.query(`DELETE FROM session WHERE "userId" = $1 AND "twoStepPending"`, [candidateId]);
    return (rowCount ?? 0) > 0;
  }

  const secondStepDone = (client: PoolClient, sessionId: string, at: Date) =>
    client.query(`UPDATE session SET "twoStepPending" = false, "twoStepVerifiedAt" = $2 WHERE id = $1`, [sessionId, at]);

  /** The app's secret; null when there is none, or it no longer opens (AUTH_SECRET rotated): the backup codes still work then. */
  async function decrypt(data: string | null): Promise<string | null> {
    if (data === null) return null;
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

        return failed(client, by.candidateId, row, at, "invalid_code");
      });
      recordSecondStep(started, result);
      return result;
    },

    async passkeyChallenge(by) {
      if (!(await hasTwoStepVerification(database, by.candidateId))) return null;
      const { rows } = await database.query<Pick<StoredPasskey, "credentialID" | "transports">>(`SELECT "credentialID", transports FROM passkey WHERE "userId" = $1`, [by.candidateId]);
      if (rows.length === 0) return null;
      const request = await passkeyRequest(relyingParty(), rows);
      await database.query(`UPDATE session SET "twoStepChallenge" = $3 WHERE id = $1 AND "userId" = $2`, [by.sessionId, by.candidateId, request.challenge]);
      return request;
    },

    async verifyPasskey(by, answer) {
      const started = clock();
      const result = await inTransaction(database, async (client): Promise<SecondStepResult> => {
        const row = await lockedRow(client, by.candidateId);
        if (!row?.enabled_at) return { ok: false, error: "not_enabled" };
        const at = now();
        if (row.locked_until && row.locked_until > at) return { ok: false, error: "locked", retryAt: row.locked_until };

        // The session's challenge serves one answer, right or wrong.
        const { rows: sessions } = await client.query<{ twoStepChallenge: string | null }>(`SELECT "twoStepChallenge" FROM session WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [
          by.sessionId,
          by.candidateId,
        ]);
        const challenge = sessions[0]?.twoStepChallenge;
        if (challenge) await client.query(`UPDATE session SET "twoStepChallenge" = NULL WHERE id = $1`, [by.sessionId]);
        const credentialId = credentialIdOf(answer);
        // Only a passkey of the pending session's own account is looked at.
        const { rows: passkeys } = credentialId
          ? await client.query<StoredPasskey>(`SELECT id, "credentialID", "publicKey", counter, transports FROM passkey WHERE "credentialID" = $1 AND "userId" = $2 FOR UPDATE`, [
              credentialId,
              by.candidateId,
            ])
          : { rows: [] };
        const passkey = passkeys[0];
        const counter = challenge && passkey ? await checkedPasskey(relyingParty(), passkey, challenge, answer) : null;
        if (counter === null || !passkey) return failed(client, by.candidateId, row, at, "invalid_passkey");

        await client.query(`UPDATE passkey SET counter = $2, "lastUsedAt" = $3 WHERE id = $1`, [passkey.id, counter, at]);
        await client.query(`UPDATE two_step_verification SET failed_attempts = 0, locked_until = NULL WHERE candidate_id = $1`, [by.candidateId]);
        await secondStepDone(client, by.sessionId, at);
        return { ok: true, factor: "passkey" };
      });
      recordSecondStep(started, result);
      return result;
    },

    async enableWithPasskey(by) {
      const started = clock();
      const result = await inTransaction(database, async (client): Promise<SetupResult> => {
        const row = await lockedRow(client, by.candidateId);
        if (row?.enabled_at) return { ok: false, error: "already_enabled" };
        const { rowCount } = await client.query(`SELECT 1 FROM passkey WHERE "userId" = $1`, [by.candidateId]);
        if (!rowCount) return { ok: false, error: "no_passkey" };
        const at = now();
        const backupCodes = newBackupCodes();
        // An authenticator app being set up, not confirmed, is forgotten.
        await client.query(
          `INSERT INTO two_step_verification (candidate_id, enabled_at, backup_codes, backup_codes_added_at) VALUES ($1, $2, $3, $2)
           ON CONFLICT (candidate_id) DO UPDATE
             SET totp_secret = NULL, totp_added_at = NULL, totp_last_step = NULL, totp_last_used_at = NULL, enabled_at = $2, backup_codes = $3,
                 backup_codes_added_at = $2, backup_code_last_used_at = NULL, failed_attempts = 0, locked_until = NULL`,
          [by.candidateId, at, backupCodes.map(hashed)],
        );
        await secondStepDone(client, by.sessionId, at);
        return { ok: true, backupCodes };
      });
      if (result.ok) record("setup", started, 200);
      return result;
    },

    async removePasskey(by, passkeyId) {
      return inTransaction(database, async (client): Promise<PasskeyRemoval> => {
        const row = await lockedRow(client, by.candidateId);
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM passkey WHERE "userId" = $1 FOR UPDATE`, [by.candidateId]);
        if (!rows.some(({ id }) => id === passkeyId)) return { ok: false, error: "not_found" };
        const last = Boolean(row?.enabled_at) && !row?.totp_added_at && rows.length === 1;
        if (last && !isRecentSecondStep(by.secondStepAt, now())) return { ok: false, error: "recent_second_step_required" };
        await client.query(`DELETE FROM passkey WHERE id = $1 AND "userId" = $2`, [passkeyId, by.candidateId]);
        if (last) await turnOff(client, by.candidateId);
        return { ok: true, disabled: last };
      });
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
      return inTransaction(database, (client) => turnOff(client, candidateId));
    },
  };
}

/**
 * Creates or upgrades the Two-step verification table, and the passkeys' last use. Run after Better Auth's tables
 * (`candidate`, `passkey`). Safe to run repeatedly.
 */
export async function migrateTwoStepVerification(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS two_step_verification (
      candidate_id text PRIMARY KEY REFERENCES candidate (id) ON DELETE CASCADE,
      -- The authenticator app's secret, encrypted with AUTH_SECRET; set up but not confirmed while totp_added_at is null.
      totp_secret text,
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
  // Turned on with a passkey alone (#664), it has no app's secret.
  await database.query(`ALTER TABLE two_step_verification ALTER COLUMN totp_secret DROP NOT NULL`);
  // When each passkey last served as a second step: Better Auth's plugin keeps no such date.
  await database.query(`ALTER TABLE passkey ADD COLUMN IF NOT EXISTS "lastUsedAt" timestamptz`);
}
