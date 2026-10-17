/**
 * Sign-in Providers (CONTEXT.md, #209): the identity providers super-admins configure
 * in the Back Office's Connexion section, kept in our database, used without a deploy.
 *
 * One deep module. `createSignInProviders(database, deps)` answers:
 *  - what is configured, as the Back Office shows it     `list`, `settings`: never a secret
 *  - change it                                            `save` (add or edit), `remove`, `setRequireSsoForAdministrators`
 *  - a test sign-in through a provider not enabled         `startTestSignIn` (a super-admin, from Connexion),
 *                                                         `completeTestSignIn` (its callback, with the nonce)
 *  - what the sign-in is built from (web app only)        `load`: the SignInConfiguration, secrets opened
 *  - Apple's client secret, signed again monthly          `regenerateAppleClientSecrets` (the worker's job)
 * and `configurationFromEnv(env)` (before the table exists, or without a database),
 * `migrateSignInProviders(database, env)` and SIGN_IN_PROVIDERS_CHANNEL.
 *
 * A provider's secrets (client secrets; Apple's Team ID, Key ID and .p8 key, and the
 * client secret signed from them) are Provider Secrets (ADR-0020): sealed with the same
 * cipher into the same `provider_secret` table, under names the Clés section does not
 * list (`sign-in/<id>/<field>`), and moved to a new master key by the same nightly job.
 * A secret goes in, never out: only `load` returns values, and it stays on the server.
 *
 * Every change is made, recorded in the Back Office Audit (without any secret) and
 * announced with NOTIFY in one transaction, so every process rebuilds its sign-in within
 * seconds. Google's client secret falls back to env's GOOGLE_CLIENT_SECRET, and env's
 * Google client is seeded as a provider once, by the migration.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { BackOffice, BackOfficeActor, Recorded } from "../admin/back-office";
import type { Queryable } from "../database/pool";
import type { SecretCipher } from "../provider-secrets/cipher";
import { AppleKeyError, appleClientSecret, appleNextRegeneration, appleRegenerationDue } from "./apple";
import {
  callbackPath,
  isSignInProviderType,
  isValidOidcId,
  SECRET_FIELDS,
  type SecretField,
  type SignInConfiguration,
  type SignInProvider,
  type SignInProviderType,
} from "./catalog";

export type { SignInConfiguration, SignInProvider, SignInProviderType } from "./catalog";

type Env = Record<string, string | undefined>;

/** The Postgres channel a change is announced on. Its payload is empty. */
export const SIGN_IN_PROVIDERS_CHANNEL = "sign_in_providers_changed";

/** The `provider` of their rows in `provider_secret`. */
const SECRET_PROVIDER = "sign-in";
const secretName = (id: string, field: SecretField) => `sign-in/${id}/${field}`;
const REQUIRE_SSO = "require_sso_for_administrators";
const UNDEFINED_TABLE = "42P01";
const MAX_SECRET_LENGTH = 8192;
/** How long a test sign-in started from Connexion may take: the provider is registered meanwhile. */
const TEST_SIGN_IN_MINUTES = 10;
/** How long an issuer's discovery document may take to come, and how long a fetched one is used. */
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_CACHE_MS = 60 * 60_000;
const hashOf = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/** Where a provider's secret in use comes from; `unreadable`: a row that does not open. */
export type SignInSecretSource = "database" | "env" | "missing" | "unreadable";

/** One provider, as the Back Office shows it. Never a secret. */
export interface SignInProviderStatus {
  id: string;
  type: SignInProviderType;
  displayName: string;
  clientId: string;
  discoveryUrl: string | null;
  tenantId: string | null;
  appBundleIdentifier: string | null;
  enabled: boolean;
  shownToCandidates: boolean;
  allowedForAdministrators: boolean;
  trustedForLinking: boolean;
  /** To paste in the provider's console, after the app's origin. */
  callbackPath: string;
  secrets: { field: SecretField; source: SignInSecretSource }[];
  /** When a test sign-in last passed since its credentials changed; null: none. */
  testedAt: Date | null;
  /** Apple's client secret: when signed, until when valid, when signed again, when that last failed. */
  apple: { generatedAt: Date | null; expiresAt: Date | null; nextRegenerationAt: Date | null; failedAt: Date | null } | null;
  updatedBy: string | null;
  updatedAt: Date;
}

export type SaveError =
  | "invalid_type"
  | "invalid_id"
  | "invalid_display_name"
  | "invalid_client_id"
  | "invalid_discovery_url"
  | "invalid_tenant"
  | "invalid_bundle_id"
  | "missing_secret"
  | "too_long"
  | "invalid_apple_key"
  | "no_master_key"
  /** Enabling needs a test sign-in that passed since the credentials last changed. */
  | "not_tested";

export type SaveResult = { ok: true; id: string } | { ok: false; error: SaveError };

export interface SignInProvidersDeps {
  /** Null without SECRETS_MASTER_KEYS: no secret can be saved, nor opened. */
  cipher: SecretCipher | null;
  backOffice: Pick<BackOffice, "record">;
  /** The process environment: Google's fallback. */
  env: Env;
  now?: () => Date;
  /** Where a secret that does not open is said. Default: console.warn. */
  log?: (line: string) => void;
  /** An OIDC issuer's discovery document, or null. Default: fetchDiscoveryDocument (5 s at most), kept an hour. */
  fetchDiscovery?: (url: string) => Promise<Record<string, unknown> | null>;
}

export interface SignInProviders {
  list(): Promise<SignInProviderStatus[]>;
  settings(): Promise<{ requireSsoForAdministrators: boolean }>;
  /**
   * `actor` adds or edits a provider from `input` (untrusted): its id (OIDC only; a social
   * provider's id is its type), type, displayName, clientId, discoveryUrl (OIDC), tenantId
   * (Microsoft), appBundleIdentifier (Apple), the four switches and `secrets` (empty ones
   * are kept as they are). Nothing is saved when refused.
   */
  save(actor: BackOfficeActor, input: unknown): Promise<SaveResult>;
  remove(actor: BackOfficeActor, id: unknown): Promise<{ ok: true } | { ok: false; error: "unknown_provider" }>;
  setRequireSsoForAdministrators(actor: BackOfficeActor, on: boolean): Promise<void>;
  /**
   * `actor` (a super-admin, from Connexion) starts a test sign-in through provider `id`, not
   * enabled: it is registered for TEST_SIGN_IN_MINUTES, and the nonce returned (stored only
   * hashed) must come back with the provider's callback.
   */
  startTestSignIn(actor: BackOfficeActor, id: unknown): Promise<{ ok: true; nonce: string } | { ok: false; error: "unknown_provider" | "already_enabled" }>;
  /**
   * A sign-in through provider `id` came back with `nonce`: true, once, when it is the test sign-in
   * started for it in the last TEST_SIGN_IN_MINUTES. The provider is then marked tested (it may be
   * enabled), recorded in the Back Office Audit as the super-admin who started it.
   */
  completeTestSignIn(id: string, nonce: string): Promise<boolean>;
  /** The configuration in use, with its secrets: for the Better Auth instance only. */
  load(): Promise<SignInConfiguration>;
  /** Signs Apple's client secret again where due (APPLE_REGENERATION_DAYS); which were, which failed and why. */
  regenerateAppleClientSecrets(): Promise<{ regenerated: string[]; failed: { id: string; reason: "missing_secret" | "invalid_apple_key" | "no_master_key" }[] }>;
}

interface ProviderRow {
  id: string;
  type: SignInProviderType;
  display_name: string;
  client_id: string;
  discovery_url: string | null;
  tenant_id: string | null;
  app_bundle_identifier: string | null;
  enabled: boolean;
  shown_to_candidates: boolean;
  allowed_for_administrators: boolean;
  trusted_for_linking: boolean;
  tested_at: Date | null;
  test_nonce_hash: string | null;
  test_started_at: Date | null;
  test_started_by_id: string | null;
  test_started_by_email: string | null;
  apple_generated_at: Date | null;
  apple_expires_at: Date | null;
  apple_failed_at: Date | null;
  updated_by_email: string | null;
  updated_at: Date;
}

interface SecretRow {
  id: string;
  name: string;
  provider: string;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  key_version: number;
}

const DEFAULT_NAMES: Record<SignInProviderType, string> = { google: "Google", apple: "Apple", microsoft: "Microsoft", oidc: "" };

/** Env's Google client, as a provider; undefined when env has none. */
function googleFromEnv(env: Env): SignInProvider | undefined {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return { id: "google", type: "google", displayName: "Google", clientId, clientSecret, enabled: true, shownToCandidates: true, allowedForAdministrators: true, trustedForLinking: true };
}

/** The configuration from env alone: env's Google client, if any. Before the migration has run, or without a database. */
export function configurationFromEnv(env: Env): SignInConfiguration {
  const google = googleFromEnv(env);
  return { providers: google ? [google] : [], requireSsoForAdministrators: false, version: google ? `env:google:${google.clientId}` : "env" };
}

/** A provider's fields as the Back Office Audit records them: no secret. */
const recorded = (row: Omit<ProviderRow, "tested_at" | "test_nonce_hash" | "test_started_at" | "test_started_by_id" | "test_started_by_email" | "apple_generated_at" | "apple_expires_at" | "apple_failed_at" | "updated_by_email" | "updated_at">): { [key: string]: Recorded } => ({
  type: row.type,
  displayName: row.display_name,
  clientId: row.client_id,
  discoveryUrl: row.discovery_url,
  tenantId: row.tenant_id,
  appBundleIdentifier: row.app_bundle_identifier,
  enabled: row.enabled,
  shownToCandidates: row.shown_to_candidates,
  allowedForAdministrators: row.allowed_for_administrators,
  trustedForLinking: row.trusted_for_linking,
});

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** An issuer's discovery document address: https, or http on this machine (development). */
function isDiscoveryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

/**
 * An OIDC issuer's discovery document at `url`, or null when it does not come within `timeoutMs`
 * or is not one (no https issuer, no authorization endpoint). Said in the log, without secrets.
 */
export async function fetchDiscoveryDocument(
  url: string,
  options: { fetch?: (url: string, init?: RequestInit) => Promise<Response>; timeoutMs?: number; log?: (line: string) => void } = {},
): Promise<Record<string, unknown> | null> {
  const log = options.log ?? ((line: string) => console.warn(line));
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, { signal: AbortSignal.timeout(options.timeoutMs ?? DISCOVERY_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const document = (await response.json()) as Record<string, unknown>;
    if (typeof document.issuer !== "string" || !URL.canParse(document.issuer)) throw new Error("no issuer");
    if (typeof document.authorization_endpoint !== "string") throw new Error("no authorization endpoint");
    return document;
  } catch (error) {
    log(`[sign-in-providers] the discovery document at ${url} could not be read, its provider is left out: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function createSignInProviders(database: Pool, deps: SignInProvidersDeps): SignInProviders {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const now = deps.now ?? (() => new Date());
  const discoveries = new Map<string, { document: Record<string, unknown>; until: number }>();
  /** An issuer's discovery document, fetched again an hour after it last was; null when it does not come. */
  async function discoveryOf(url: string): Promise<Record<string, unknown> | null> {
    const cached = discoveries.get(url);
    if (cached && cached.until > Date.now()) return cached.document;
    const document = await (deps.fetchDiscovery ?? ((address: string) => fetchDiscoveryDocument(address, { log })))(url);
    if (document) discoveries.set(url, { document, until: Date.now() + DISCOVERY_CACHE_MS });
    else discoveries.delete(url);
    return document;
  }
  const testPending = (row: ProviderRow, at: Date) =>
    !row.enabled && row.test_started_at !== null && row.test_started_at.getTime() > at.getTime() - TEST_SIGN_IN_MINUTES * 60_000;
  const place = (row: Pick<SecretRow, "name" | "id">) => ({ provider: SECRET_PROVIDER, name: row.name, row: row.id });

  async function providerRows(within: Queryable = database): Promise<ProviderRow[]> {
    const { rows } = await within.query<ProviderRow>("SELECT * FROM sign_in_provider ORDER BY created_at, id");
    return rows.filter((row) => isSignInProviderType(row.type));
  }

  async function secretRows(within: Queryable = database): Promise<Map<string, SecretRow>> {
    const { rows } = await within.query<SecretRow>("SELECT id, name, provider, ciphertext, iv, tag, key_version FROM provider_secret WHERE provider = $1", [SECRET_PROVIDER]);
    return new Map(rows.map((row) => [row.name, row]));
  }

  /** The value of a secret row, or null when there is none or it does not open (said, without value). */
  function open(row: SecretRow | undefined): string | null {
    if (!row || !deps.cipher) return null;
    try {
      return deps.cipher.open({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyVersion: row.key_version }, place(row));
    } catch (error) {
      log(`[sign-in-providers] ${error instanceof Error ? error.message : "a secret does not open"}`);
      return null;
    }
  }

  /** The opened secrets of provider `row`, by field; Google's client secret falls back to env's. */
  function secretsOf(row: Pick<ProviderRow, "id" | "type">, stored: Map<string, SecretRow>): Partial<Record<SecretField, string>> {
    const fields: SecretField[] = [...SECRET_FIELDS[row.type], ...(row.type === "apple" ? (["clientSecret"] as const) : [])];
    const opened: Partial<Record<SecretField, string>> = {};
    for (const field of fields) {
      const value = open(stored.get(secretName(row.id, field)));
      if (value !== null) opened[field] = value;
    }
    if (row.type === "google" && !opened.clientSecret && deps.env.GOOGLE_CLIENT_SECRET?.trim()) opened.clientSecret = deps.env.GOOGLE_CLIENT_SECRET.trim();
    return opened;
  }

  /** Seals `value` as secret `field` of provider `id`, replacing the one there. */
  async function writeSecret(within: Queryable, cipher: SecretCipher, id: string, field: SecretField, value: string, email: string | null): Promise<void> {
    const name = secretName(id, field);
    const row = randomUUID();
    const sealed = cipher.seal(value, { provider: SECRET_PROVIDER, name, row });
    await within.query(
      `INSERT INTO provider_secret (name, id, provider, ciphertext, iv, tag, key_version, updated_by_email, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (name) DO UPDATE SET id = excluded.id, provider = excluded.provider, ciphertext = excluded.ciphertext, iv = excluded.iv,
         tag = excluded.tag, key_version = excluded.key_version, updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at`,
      [name, row, SECRET_PROVIDER, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion, email ?? "worker"],
    );
  }

  const announce = (within: Queryable) => within.query("SELECT pg_notify($1, '')", [SIGN_IN_PROVIDERS_CHANNEL]);

  async function requireSso(within: Queryable = database): Promise<boolean> {
    const { rows } = await within.query<{ value: unknown }>("SELECT value FROM sign_in_setting WHERE name = $1", [REQUIRE_SSO]);
    return rows[0]?.value === true;
  }

  return {
    async list() {
      const [rows, stored] = await Promise.all([providerRows(), secretRows()]);
      return rows.map((row): SignInProviderStatus => {
        const opened = secretsOf(row, stored);
        const secrets = SECRET_FIELDS[row.type].map((field) => {
          const inDatabase = stored.has(secretName(row.id, field));
          const source: SignInSecretSource =
            inDatabase && opened[field] !== undefined ? "database" : inDatabase ? "unreadable" : opened[field] !== undefined ? "env" : "missing";
          return { field, source };
        });
        return {
          id: row.id,
          type: row.type,
          displayName: row.display_name,
          clientId: row.client_id,
          discoveryUrl: row.discovery_url,
          tenantId: row.tenant_id,
          appBundleIdentifier: row.app_bundle_identifier,
          enabled: row.enabled,
          shownToCandidates: row.shown_to_candidates,
          allowedForAdministrators: row.allowed_for_administrators,
          trustedForLinking: row.trusted_for_linking,
          callbackPath: callbackPath(row.id),
          secrets,
          testedAt: row.tested_at,
          apple:
            row.type === "apple"
              ? {
                  generatedAt: row.apple_generated_at,
                  expiresAt: row.apple_expires_at,
                  nextRegenerationAt: row.apple_generated_at ? appleNextRegeneration(row.apple_generated_at) : null,
                  failedAt: row.apple_failed_at,
                }
              : null,
          updatedBy: row.updated_by_email,
          updatedAt: row.updated_at,
        };
      });
    },

    async settings() {
      return { requireSsoForAdministrators: await requireSso() };
    },

    async save(actor, input) {
      const fields = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
      const type = fields.type;
      if (!isSignInProviderType(type)) return { ok: false, error: "invalid_type" };
      const id = type === "oidc" ? text(fields.id) : type;
      if (type === "oidc" && !isValidOidcId(id)) return { ok: false, error: "invalid_id" };
      const [rows, stored] = await Promise.all([providerRows(), secretRows()]);
      const existing = rows.find((row) => row.id === id);
      if (existing && existing.type !== type) return { ok: false, error: "invalid_id" };

      const displayName = text(fields.displayName) || DEFAULT_NAMES[type];
      if (!displayName || displayName.length > 60) return { ok: false, error: "invalid_display_name" };
      const clientId = text(fields.clientId);
      if (!clientId || clientId.length > 512) return { ok: false, error: "invalid_client_id" };
      const discoveryUrl = type === "oidc" ? text(fields.discoveryUrl) : null;
      if (type === "oidc" && (!discoveryUrl || discoveryUrl.length > 2048 || !isDiscoveryUrl(discoveryUrl))) return { ok: false, error: "invalid_discovery_url" };
      const tenantId = type === "microsoft" ? text(fields.tenantId) || "common" : null;
      if (tenantId !== null && !/^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/.test(tenantId)) return { ok: false, error: "invalid_tenant" };
      const appBundleIdentifier = type === "apple" ? text(fields.appBundleIdentifier) || null : null;
      if (appBundleIdentifier !== null && !/^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/.test(appBundleIdentifier)) return { ok: false, error: "invalid_bundle_id" };

      const typed = (typeof fields.secrets === "object" && fields.secrets !== null ? fields.secrets : {}) as Record<string, unknown>;
      const replaced: Partial<Record<SecretField, string>> = {};
      for (const field of SECRET_FIELDS[type]) {
        const value = text(typed[field]);
        if (value.length > MAX_SECRET_LENGTH) return { ok: false, error: "too_long" };
        if (value) replaced[field] = value;
      }
      const secrets = { ...(existing ? secretsOf(existing, stored) : type === "google" ? secretsOf({ id, type }, stored) : {}), ...replaced };
      if (SECRET_FIELDS[type].some((field) => !secrets[field])) return { ok: false, error: Object.keys(replaced).length > 0 && !deps.cipher ? "no_master_key" : "missing_secret" };
      const cipher = deps.cipher;
      if (!cipher && (Object.keys(replaced).length > 0 || type === "apple")) return { ok: false, error: "no_master_key" };

      const credentialsChanged =
        !existing ||
        existing.client_id !== clientId ||
        existing.discovery_url !== discoveryUrl ||
        existing.tenant_id !== tenantId ||
        existing.app_bundle_identifier !== appBundleIdentifier ||
        Object.keys(replaced).length > 0;
      const testedAt = credentialsChanged ? null : existing.tested_at;
      const enabled = fields.enabled === true;
      if (enabled && !existing?.enabled && !testedAt) return { ok: false, error: "not_tested" };

      let apple: { clientSecret: string; expiresAt: Date; generatedAt: Date } | null = null;
      if (type === "apple" && (credentialsChanged || !secrets.clientSecret)) {
        const generatedAt = now();
        try {
          apple = { ...appleClientSecret({ teamId: secrets.teamId!, keyId: secrets.keyId!, privateKey: secrets.privateKey!, clientId }, generatedAt), generatedAt };
        } catch (error) {
          if (error instanceof AppleKeyError) return { ok: false, error: "invalid_apple_key" };
          throw error;
        }
      }

      const after = {
        id,
        type,
        display_name: displayName,
        client_id: clientId,
        discovery_url: discoveryUrl,
        tenant_id: tenantId,
        app_bundle_identifier: appBundleIdentifier,
        enabled,
        shown_to_candidates: fields.shownToCandidates === true,
        allowed_for_administrators: fields.allowedForAdministrators === true,
        // Google, Apple and Microsoft always are (see policy.ts for Microsoft's multi-tenant directories).
        trusted_for_linking: type === "oidc" ? fields.trustedForLinking === true : true,
      };
      const email = actor.email.trim().toLowerCase();
      await deps.backOffice.record(
        actor,
        async (within) => {
          await within.query(
            `INSERT INTO sign_in_provider (id, type, display_name, client_id, discovery_url, tenant_id, app_bundle_identifier, enabled,
               shown_to_candidates, allowed_for_administrators, trusted_for_linking, tested_at, updated_by_email, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, clock_timestamp())
             ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, client_id = excluded.client_id, discovery_url = excluded.discovery_url,
               tenant_id = excluded.tenant_id, app_bundle_identifier = excluded.app_bundle_identifier, enabled = excluded.enabled,
               shown_to_candidates = excluded.shown_to_candidates, allowed_for_administrators = excluded.allowed_for_administrators,
               trusted_for_linking = excluded.trusted_for_linking, tested_at = excluded.tested_at, updated_by_email = excluded.updated_by_email,
               updated_at = excluded.updated_at`,
            [
              id,
              type,
              after.display_name,
              clientId,
              discoveryUrl,
              tenantId,
              appBundleIdentifier,
              enabled,
              after.shown_to_candidates,
              after.allowed_for_administrators,
              after.trusted_for_linking,
              testedAt,
              email,
            ],
          );
          for (const [field, value] of Object.entries(replaced) as [SecretField, string][]) await writeSecret(within, cipher!, id, field, value, email);
          if (apple) {
            await writeSecret(within, cipher!, id, "clientSecret", apple.clientSecret, email);
            await within.query("UPDATE sign_in_provider SET apple_generated_at = $2, apple_expires_at = $3, apple_failed_at = NULL WHERE id = $1", [id, apple.generatedAt, apple.expiresAt]);
          }
          await announce(within);
        },
        () => {
          const secretsReplaced = Object.keys(replaced);
          return {
            section: "sign_in_providers",
            target: id,
            action: existing ? "updated" : "added",
            before: existing ? recorded(existing) : null,
            after: { ...recorded(after), ...(secretsReplaced.length > 0 ? { secretsReplaced } : {}) },
          };
        },
      );
      return { ok: true, id };
    },

    async remove(actor, rawId) {
      const id = text(rawId);
      const removed = await deps.backOffice.record(
        actor,
        async (within) => {
          const { rows } = await within.query<ProviderRow>("DELETE FROM sign_in_provider WHERE id = $1 RETURNING *", [id]);
          const row = rows[0];
          if (!row) return null;
          const names = [...SECRET_FIELDS[row.type], "clientSecret" as const].map((field) => secretName(row.id, field));
          await within.query("DELETE FROM provider_secret WHERE provider = $1 AND name = ANY($2::text[])", [SECRET_PROVIDER, names]);
          await announce(within);
          return row;
        },
        (row) => (row ? { section: "sign_in_providers", target: row.id, action: "removed", before: recorded(row), after: null } : null),
      );
      return removed ? { ok: true } : { ok: false, error: "unknown_provider" };
    },

    async setRequireSsoForAdministrators(actor, on) {
      await deps.backOffice.record(
        actor,
        async (within) => {
          const before = await requireSso(within);
          if (before === on) return null;
          await within.query(
            `INSERT INTO sign_in_setting (name, value, updated_by_email, updated_at) VALUES ($1, $2::jsonb, $3, clock_timestamp())
             ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at`,
            [REQUIRE_SSO, JSON.stringify(on), actor.email.trim().toLowerCase()],
          );
          await announce(within);
          return { before };
        },
        (changed) => (changed ? { section: "sign_in_providers", target: REQUIRE_SSO, action: "updated", before: changed.before, after: on } : null),
      );
    },

    async startTestSignIn(actor, rawId) {
      const id = text(rawId);
      const nonce = randomBytes(32).toString("base64url");
      // One statement: the test is started and announced (the provider registered everywhere) together.
      const { rows } = await database.query<{ enabled: boolean; started: boolean }>(
        `WITH found AS (SELECT id, enabled FROM sign_in_provider WHERE id = $1),
              started AS (
                UPDATE sign_in_provider SET test_nonce_hash = $2, test_started_at = $3, test_started_by_id = $4, test_started_by_email = $5
                WHERE id = $1 AND NOT enabled RETURNING id
              ),
              announced AS (SELECT pg_notify($6, '') FROM started)
         SELECT found.enabled, EXISTS (SELECT 1 FROM started) AS started FROM found LEFT JOIN announced ON true`,
        [id, hashOf(nonce), now(), actor.id, actor.email.trim().toLowerCase(), SIGN_IN_PROVIDERS_CHANNEL],
      );
      if (!rows[0]) return { ok: false, error: "unknown_provider" };
      if (!rows[0].started) return { ok: false, error: "already_enabled" };
      return { ok: true, nonce };
    },

    async completeTestSignIn(id, nonce) {
      const at = now();
      const since = new Date(at.getTime() - TEST_SIGN_IN_MINUTES * 60_000);
      const { rows } = await database.query<{ test_started_by_id: string; test_started_by_email: string }>(
        `SELECT test_started_by_id, test_started_by_email FROM sign_in_provider
         WHERE id = $1 AND NOT enabled AND test_nonce_hash = $2 AND test_started_at > $3`,
        [id, hashOf(nonce), since],
      );
      const starter = rows[0];
      if (!starter) return false;
      return deps.backOffice.record(
        { id: starter.test_started_by_id, email: starter.test_started_by_email },
        async (within) => {
          // Used once: a second callback with the same nonce finds nothing.
          const used = await within.query(
            `UPDATE sign_in_provider SET tested_at = $4, test_nonce_hash = NULL, test_started_at = NULL, test_started_by_id = NULL, test_started_by_email = NULL
             WHERE id = $1 AND NOT enabled AND test_nonce_hash = $2 AND test_started_at > $3 RETURNING id`,
            [id, hashOf(nonce), since, at],
          );
          if (used.rowCount === 0) return false;
          await announce(within);
          return true;
        },
        (passed) => (passed ? { section: "sign_in_providers", target: id, action: "tested", before: null, after: null } : null),
      );
    },

    async load() {
      let rows: ProviderRow[];
      let stored: Map<string, SecretRow>;
      let sso: boolean;
      try {
        [rows, stored, sso] = await Promise.all([providerRows(), secretRows(), requireSso()]);
      } catch (error) {
        if ((error as { code?: string }).code !== UNDEFINED_TABLE) throw error;
        log("[sign-in-providers] the sign_in_provider table does not exist yet (run the migrations): env's Google client alone is used");
        return configurationFromEnv(deps.env);
      }
      const at = now();
      const providers: SignInProvider[] = [];
      const discovered = new Map<string, boolean>();
      for (const row of rows) {
        const secrets = secretsOf(row, stored);
        // Not registered without its secrets: Better Auth could not use it.
        if (!secrets.clientSecret) continue;
        const pending = testPending(row, at);
        // Only for a provider Better Auth registers: one in use, or under test.
        const discovery = row.type === "oidc" && row.discovery_url && (row.enabled || pending) ? ((await discoveryOf(row.discovery_url)) ?? undefined) : undefined;
        discovered.set(row.id, discovery !== undefined);
        providers.push({
          id: row.id,
          type: row.type,
          displayName: row.display_name,
          clientId: row.client_id,
          clientSecret: secrets.clientSecret,
          discoveryUrl: row.discovery_url ?? undefined,
          tenantId: row.tenant_id ?? undefined,
          appBundleIdentifier: row.app_bundle_identifier ?? undefined,
          discovery,
          enabled: row.enabled,
          testPending: pending,
          shownToCandidates: row.shown_to_candidates,
          allowedForAdministrators: row.allowed_for_administrators,
          trustedForLinking: row.trusted_for_linking,
        });
      }
      const version = [
        ...rows.map((row) => `${row.id}@${row.updated_at.getTime()}:test=${testPending(row, at)}:discovered=${discovered.get(row.id) ?? false}`),
        ...[...stored.values()].map((row) => `${row.name}@${row.id}`).sort(),
        `sso=${sso}`,
      ].join(",");
      return { providers, requireSsoForAdministrators: sso, version };
    },

    async regenerateAppleClientSecrets() {
      const regenerated: string[] = [];
      const failed: { id: string; reason: "missing_secret" | "invalid_apple_key" | "no_master_key" }[] = [];
      const at = now();
      const [rows, stored] = await Promise.all([providerRows(), secretRows()]);
      for (const row of rows.filter((candidate) => candidate.type === "apple" && appleRegenerationDue(candidate.apple_generated_at, at))) {
        const secrets = secretsOf(row, stored);
        const fail = async (reason: (typeof failed)[number]["reason"]) => {
          failed.push({ id: row.id, reason });
          await database.query("UPDATE sign_in_provider SET apple_failed_at = $2 WHERE id = $1", [row.id, at]);
        };
        const cipher = deps.cipher;
        if (!cipher) {
          await fail("no_master_key");
          continue;
        }
        if (!secrets.teamId || !secrets.keyId || !secrets.privateKey) {
          await fail("missing_secret");
          continue;
        }
        let signed;
        try {
          signed = appleClientSecret({ teamId: secrets.teamId, keyId: secrets.keyId, privateKey: secrets.privateKey, clientId: row.client_id }, at);
        } catch (error) {
          if (!(error instanceof AppleKeyError)) throw error;
          await fail("invalid_apple_key");
          continue;
        }
        const client = await database.connect();
        try {
          await client.query("BEGIN");
          await writeSecret(client, cipher, row.id, "clientSecret", signed.clientSecret, null);
          await client.query("UPDATE sign_in_provider SET apple_generated_at = $2, apple_expires_at = $3, apple_failed_at = NULL WHERE id = $1", [row.id, at, signed.expiresAt]);
          await announce(client);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        regenerated.push(row.id);
      }
      return { regenerated, failed };
    },
  };
}

/**
 * Creates the Sign-in Providers' tables, then seeds env's Google client (GOOGLE_CLIENT_ID
 * and GOOGLE_CLIENT_SECRET) as a provider, once: shown to Candidates, allowed for
 * Administrators, its secret left in env. Run after the Provider Secrets'. Safe to run repeatedly.
 */
export async function migrateSignInProviders(database: Pick<Pool, "query">, env: Env): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS sign_in_provider (
      -- google, apple, microsoft, or an OIDC provider's own id: Better Auth's provider id.
      id text PRIMARY KEY,
      type text NOT NULL,
      display_name text NOT NULL,
      client_id text NOT NULL,
      discovery_url text,
      tenant_id text,
      app_bundle_identifier text,
      enabled boolean NOT NULL DEFAULT false,
      shown_to_candidates boolean NOT NULL DEFAULT false,
      allowed_for_administrators boolean NOT NULL DEFAULT false,
      trusted_for_linking boolean NOT NULL DEFAULT false,
      -- A test sign-in passed since the credentials last changed: it may be enabled.
      tested_at timestamptz,
      -- The test sign-in a super-admin started from Connexion: its nonce, hashed, and who started it when.
      test_nonce_hash text,
      test_started_at timestamptz,
      test_started_by_id text,
      test_started_by_email text,
      apple_generated_at timestamptz,
      apple_expires_at timestamptz,
      apple_failed_at timestamptz,
      -- The Administrator by email only (null: seeded from env), like provider_secret: never in a Candidate's data export.
      updated_by_email text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE sign_in_provider ADD COLUMN IF NOT EXISTS test_nonce_hash text;
    ALTER TABLE sign_in_provider ADD COLUMN IF NOT EXISTS test_started_at timestamptz;
    ALTER TABLE sign_in_provider ADD COLUMN IF NOT EXISTS test_started_by_id text;
    ALTER TABLE sign_in_provider ADD COLUMN IF NOT EXISTS test_started_by_email text;
    CREATE TABLE IF NOT EXISTS sign_in_setting (
      name text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_by_email text,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
  const google = googleFromEnv(env);
  if (!google) return;
  // One statement: the marker and the seed are kept together or not at all.
  await database.query(
    `WITH seeded AS (
       INSERT INTO sign_in_setting (name, value) VALUES ('google_seeded_from_env', 'true'::jsonb) ON CONFLICT (name) DO NOTHING RETURNING name
     )
     INSERT INTO sign_in_provider (id, type, display_name, client_id, enabled, shown_to_candidates, allowed_for_administrators, trusted_for_linking, tested_at)
     SELECT 'google', 'google', 'Google', $1, true, true, true, true, clock_timestamp() FROM seeded
     ON CONFLICT (id) DO NOTHING`,
    [google.clientId],
  );
}
