/**
 * Push notifications (CONTEXT.md, ADR-0076): what the Jobbbox app shows on a device's lock screen, sent by the worker
 * directly to APNs (iOS, iPadOS) and FCM (Android), never through Expo's push service.
 *
 * One deep module in front of Postgres. Callers get `createPushNotifications(database, deps)`:
 *  - `register` and `forget`: the app's side. A device is the token the app was given by its platform, tied to the account
 *    and to the session signed in on it: it goes with the account, at that session's sign-out (or revocation), and when its
 *    provider says the token is no longer valid. Registering the same token again updates its language and date last seen,
 *    and moves it to the account signed in on the device now.
 *  - `devices`: the person's devices, without their token (Rappels, the Data export).
 *  - `settings` and `setEnabled`: one switch per event in Mon compte's Rappels Section, each on until switched off.
 *  - `send`: the worker's side. One notification to each of the person's devices whose session is still valid, for an
 *    event they did not switch off, in the device's language, through its platform's provider. A failure is kept with
 *    its Failure Reason, platform and event (never the token, the account nor the text), for FAILURE_RETENTION_DAYS.
 */
import { isSupportedLocale, type Locale } from "@jobhub/shared/i18n";
import type { PushFailureReason } from "@jobhub/shared";
import type { Pool } from "pg";
import { isPushEvent, PUSH_EVENT_IDS, type PushEvent, type PushNotification, type PushNotificationEvent } from "./catalog";
import { pushMessage } from "./messages";
import { PUSH_ENVIRONMENTS, PUSH_PLATFORMS, type PushEnvironment, type PushOutcome, type PushPlatform, type PushSender } from "./senders";

export { PUSH_EVENTS, PUSH_EVENT_IDS, PUSH_NOTIFICATIONS_QUEUE, isPushEvent, pushEventsFor, pushNotificationOf, type PushAudience, type PushEvent, type PushNotification } from "./catalog";
export { pushMessage, type PushMessage } from "./messages";
export { PUSH_PLATFORMS, type PushPlatform, type PushSender, type PushOutcome, type PushDevice } from "./senders";

/** How long a failure to send is kept. */
export const FAILURE_RETENTION_DAYS = 90;

/** The longest token taken: APNs' are 64 hex characters, FCM's about 160; anything far longer is not one. */
const MAX_TOKEN_LENGTH = 4096;

export interface PushNotificationsDeps {
  /**
   * Each platform's provider, asked at each send (the worker's follow its Provider Secrets): null, or none, while its key
   * is not entered, and the devices of that platform fail with key_missing.
   */
  senders: () => Partial<Record<PushPlatform, PushSender | null>>;
  now?: () => Date;
  /** Where a failure's technical message goes (the worker's log). Default: nowhere. */
  log?: (line: string) => void;
}

/** A device, as the person sees it: never its token. */
export interface PushDeviceSummary {
  platform: PushPlatform;
  language: Locale;
  registeredAt: Date;
  lastSeenAt: Date;
}

/** One failure to send, as kept. */
export interface PushFailure {
  at: Date;
  platform: PushPlatform;
  event: PushNotificationEvent;
  reason: PushFailureReason;
  httpStatus: number | null;
}

/** Who registers a device: the account, and the session signed in on the device. */
export interface SignedInDevice {
  id: string;
  sessionId: string;
}

export interface PushNotifications {
  /** Registers the device the app sends (untrusted: `{ platform, token, language, environment? }`). */
  register(person: SignedInDevice, device: unknown): Promise<{ ok: true } | { ok: false; error: "invalid" }>;
  /** Forgets the person's device with this token (the app, signing out); nothing for anyone else's. */
  forget(personId: string, token: string): Promise<void>;
  /** The person's devices, first registered first. */
  devices(personId: string): Promise<PushDeviceSummary[]>;
  /** Each event's switch: on unless switched off. */
  settings(personId: string): Promise<Record<PushEvent, boolean>>;
  setEnabled(personId: string, event: PushEvent, enabled: boolean): Promise<void>;
  /**
   * Sends `notification` to the person's devices (only those of `platform` when given); the test whatever the switches.
   * How many it reached, how many failed, and how many of those were removed for a token no longer valid.
   */
  send(personId: string, notification: PushNotification, options?: { platform?: PushPlatform }): Promise<{ sent: number; failed: number; removed: number }>;
  /** The failures kept, newest first (at most `limit`, default 100). */
  failures(limit?: number): Promise<PushFailure[]>;
}

type DeviceInput = { platform: PushPlatform; token: string; language: Locale; environment: PushEnvironment };

function deviceOf(input: unknown): DeviceInput | null {
  if (typeof input !== "object" || input === null) return null;
  const { platform, token, language, environment } = input as Record<string, unknown>;
  if (!PUSH_PLATFORMS.includes(platform as PushPlatform)) return null;
  if (typeof token !== "string" || token.trim() === "" || token.length > MAX_TOKEN_LENGTH) return null;
  if (!isSupportedLocale(language)) return null;
  if (environment !== undefined && !PUSH_ENVIRONMENTS.includes(environment as PushEnvironment)) return null;
  // Android has one FCM, whatever the build.
  const env = platform === "ios" ? ((environment as PushEnvironment | undefined) ?? "production") : "production";
  return { platform: platform as PushPlatform, token: token.trim(), language, environment: env };
}

export function createPushNotifications(database: Pool, deps: PushNotificationsDeps): PushNotifications {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  async function keepFailure(platform: PushPlatform, event: PushNotificationEvent, outcome: Exclude<PushOutcome, { ok: true }>, at: Date) {
    await database.query(`INSERT INTO push_notification_failure (at, platform, event, reason, http_status) VALUES ($1, $2, $3, $4, $5)`, [at, platform, event, outcome.reason, outcome.status]);
    // The technical message stays in the worker's log: never the token (the provider's message may quote it).
    log(`[push-notifications] ${platform} ${event}: ${outcome.reason}${outcome.status === null ? "" : ` (HTTP ${outcome.status})`} ${outcome.message}`.trim());
  }

  return {
    async register(person, input) {
      const device = deviceOf(input);
      if (!device) return { ok: false, error: "invalid" };
      const at = now();
      await database.query(
        `INSERT INTO push_device (candidate_id, session_id, platform, environment, token, language, registered_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (token) DO UPDATE SET
           candidate_id = EXCLUDED.candidate_id, session_id = EXCLUDED.session_id, platform = EXCLUDED.platform,
           environment = EXCLUDED.environment, language = EXCLUDED.language, last_seen_at = EXCLUDED.last_seen_at,
           -- Another account's device now: registered anew.
           registered_at = CASE WHEN push_device.candidate_id = EXCLUDED.candidate_id THEN push_device.registered_at ELSE EXCLUDED.registered_at END`,
        [person.id, person.sessionId, device.platform, device.environment, device.token, device.language, at],
      );
      return { ok: true };
    },

    async forget(personId, token) {
      await database.query(`DELETE FROM push_device WHERE candidate_id = $1 AND token = $2`, [personId, token.trim()]);
    },

    async devices(personId) {
      const { rows } = await database.query<PushDeviceSummary>(
        `SELECT platform, language, registered_at AS "registeredAt", last_seen_at AS "lastSeenAt" FROM push_device WHERE candidate_id = $1 ORDER BY registered_at, id`,
        [personId],
      );
      return rows;
    },

    async settings(personId) {
      const { rows } = await database.query<{ event: string; enabled: boolean }>(`SELECT event, enabled FROM push_notification_setting WHERE candidate_id = $1`, [personId]);
      const off = new Set(rows.filter((row) => !row.enabled).map((row) => row.event));
      return Object.fromEntries(PUSH_EVENT_IDS.map((event) => [event, !off.has(event)])) as Record<PushEvent, boolean>;
    },

    async setEnabled(personId, event, enabled) {
      if (!isPushEvent(event)) throw new Error(`not a Push notification event: ${String(event)}`);
      await database.query(
        `INSERT INTO push_notification_setting (candidate_id, event, enabled, changed_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (candidate_id, event) DO UPDATE SET enabled = EXCLUDED.enabled, changed_at = EXCLUDED.changed_at
         WHERE push_notification_setting.enabled <> EXCLUDED.enabled`,
        [personId, event, enabled, now()],
      );
    },

    async send(personId, notification, options = {}) {
      const at = now();
      const result = { sent: 0, failed: 0, removed: 0 };
      if (notification.event !== "test" && !(await this.settings(personId))[notification.event]) return result;
      const { rows } = await database.query<{ id: string; platform: PushPlatform; environment: PushEnvironment; token: string; language: string }>(
        `SELECT d.id, d.platform, d.environment, d.token, d.language
           FROM push_device d JOIN session s ON s.id = d.session_id
          WHERE d.candidate_id = $1 AND s."expiresAt" > $2 AND ($3::text IS NULL OR d.platform = $3)
          ORDER BY d.registered_at, d.id`,
        [personId, at, options.platform ?? null],
      );
      const senders = deps.senders();
      for (const device of rows) {
        const sender = senders[device.platform];
        let outcome: PushOutcome;
        if (!sender) {
          outcome = { ok: false, reason: "key_missing", tokenInvalid: false, status: null, message: `no ${device.platform} key entered` };
        } else {
          try {
            outcome = await sender.send({ token: device.token, environment: device.environment }, pushMessage(notification, isSupportedLocale(device.language) ? device.language : "fr"));
          } catch (error) {
            outcome = { ok: false, reason: "provider_unavailable", tokenInvalid: false, status: null, message: error instanceof Error ? error.message : String(error) };
          }
        }
        if (outcome.ok) {
          result.sent += 1;
          continue;
        }
        result.failed += 1;
        await keepFailure(device.platform, notification.event, { ...outcome, message: outcome.message.replaceAll(device.token, "[token]") }, at);
        if (outcome.tokenInvalid) {
          await database.query(`DELETE FROM push_device WHERE id = $1`, [device.id]);
          result.removed += 1;
        }
      }
      return result;
    },

    async failures(limit = 100) {
      const { rows } = await database.query<PushFailure>(
        `SELECT at, platform, event, reason, http_status AS "httpStatus" FROM push_notification_failure ORDER BY at DESC, id DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  };
}

/** Deletes the failures older than FAILURE_RETENTION_DAYS; how many. */
export async function purgeExpiredPushFailures(database: Pick<Pool, "query">, now: Date = new Date()): Promise<number> {
  const { rowCount } = await database.query(`DELETE FROM push_notification_failure WHERE at < $1::timestamptz - make_interval(days => $2)`, [now, FAILURE_RETENTION_DAYS]);
  return rowCount ?? 0;
}

/** Creates or upgrades the Push notifications' tables. Run after the Candidate accounts. Safe to run repeatedly. */
export async function migratePushNotifications(database: Pick<Pool, "query">): Promise<void> {
  await database.query(`
    -- The devices the Jobbbox app registered (#698): each tied to its account and to the session signed in on it, so it
    -- goes with the account and at that session's sign-out or revocation.
    CREATE TABLE IF NOT EXISTS push_device (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      session_id text NOT NULL REFERENCES session (id) ON DELETE CASCADE,
      platform text NOT NULL CHECK (platform IN ('ios', 'android')),
      -- An iOS token's APNs environment: a development build's is the sandbox's.
      environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production', 'development')),
      -- The token its platform gave the app: never shown, never exported.
      token text NOT NULL UNIQUE,
      -- The language its notifications are written in: the app's.
      language text NOT NULL,
      registered_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS push_device_candidate_id_idx ON push_device (candidate_id);
    CREATE INDEX IF NOT EXISTS push_device_session_id_idx ON push_device (session_id);
    -- Each event a person switched in Mon compte's Rappels; none means on.
    CREATE TABLE IF NOT EXISTS push_notification_setting (
      candidate_id text NOT NULL REFERENCES candidate (id) ON DELETE CASCADE,
      event text NOT NULL,
      enabled boolean NOT NULL,
      changed_at timestamptz NOT NULL,
      PRIMARY KEY (candidate_id, event)
    );
    -- The notifications that did not reach a device, with their Failure Reason (ADR-0030): no token, no account, no text.
    CREATE TABLE IF NOT EXISTS push_notification_failure (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL,
      platform text NOT NULL,
      event text NOT NULL,
      reason text NOT NULL,
      http_status integer
    );
    CREATE INDEX IF NOT EXISTS push_notification_failure_at_idx ON push_notification_failure (at);
  `);
}
