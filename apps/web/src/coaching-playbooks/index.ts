/**
 * Coaching Playbooks (ADR-0021, #225): the Coaching Playbooks, the Core Digest and the Sources list,
 * each a series of Playbook Versions kept forever, written in the Back Office by Playbook editors.
 *
 * One deep module. `createCoachingPlaybooks(database, { serving, agentModels })` answers:
 *  - what there is          `list` (each with its latest and its served version), `history` (every version)
 *  - write                  `create` a Coaching Playbook, `save` a version, `validate` one, `setArchived`
 *  - what the AI Coach uses `served`: the Core Digest, the Sources list and the Coaching Playbooks
 *                           with their Playbook Agents, at the version this environment serves
 * and `migrateCoachingPlaybooks(database, seed)` creates its tables and, once, imports `seed`
 * as version 1 of each (see ./import).
 *
 * Rules kept here, whoever calls:
 *  - A version not yet Human-validated is edited in place, each author noted; changing a
 *    Human-validated one makes a new version. Saving without a change makes nothing.
 *  - A version is Human-validated once, by a named Administrator other than its authors, and only
 *    while it is the latest.
 *  - `serving: "validated"` (production) serves the latest Human-validated version of each;
 *    `"latest"` (every other environment) the latest version. An archived Coaching Playbook is never
 *    served, nor deleted; the Core Digest and the Sources list cannot be archived.
 *  - Every `[Sn]` a version cites must be in the latest Sources list; a Source cited by the served or
 *    latest version of a Coaching Playbook in use, or of the Core Digest, cannot leave it.
 *  - A Playbook Agent only uses a provider and model `agentModels` offers (EU-resident, ADR-0007);
 *    no model means the provider's default one. Its effort is low, medium or high.
 *
 * Every write takes an optional `within`: it then runs in the caller's transaction, as the Back
 * Office does to record it in the Back Office Audit (see admin/coaching-playbooks-back-office.ts).
 * Every input is untrusted and validated here.
 */
import { isEffort, PROVIDER_IDS, type AgentModelChoice, type Effort, type ProviderId } from "@jobhub/ai";
import { citedSourceIds, markdownTitle, parseSources, type Source } from "@jobhub/coach-knowledge";
import type { Pool, PoolClient } from "pg";
import type { Queryable } from "../database/pool";

/** The Core Digest's id. */
export const CORE_DIGEST = "core-digest";
/** The Sources list's id. */
export const SOURCES_LIST = "sources";
/** The author of the one-off import's versions. */
export const IMPORT_AUTHOR = "import";

export const PLAYBOOK_KINDS = ["playbook", "core_digest", "sources"] as const;
export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number];

/** Which versions this environment serves: production only Human-validated ones (ADR-0019, ADR-0021). */
export type PlaybookServing = "validated" | "latest";

/** Longest text a version holds, in characters. */
export const MAX_CONTENT_LENGTH = 100_000;
/** Longest "when to consult it" description, in characters. */
export const MAX_CONSULT_WHEN_LENGTH = 1_000;

/** A Coaching Playbook's specialist, as one Playbook Version sets it. */
export interface PlaybookAgent {
  provider: ProviderId;
  /** Null: the provider's default model. */
  model: string | null;
  effort: Effort;
  /** When the AI Coach should consult it, in French. */
  consultWhen: string;
}

/** Who validated a Playbook Version, and when. */
export interface Validation {
  name: string;
  email: string;
  at: Date;
}

export interface PlaybookVersion {
  playbookId: string;
  /** From 1. */
  version: number;
  /** The rules, in French Markdown; for the Sources list, its table of Sources. */
  content: string;
  /** Null for the Core Digest and the Sources list. */
  agent: PlaybookAgent | null;
  /** The email of each Administrator who saved it, the first one first; "import" for the one-off import. */
  authors: string[];
  createdAt: Date;
  updatedAt: Date;
  /** Null until Human-validated. */
  validation: Validation | null;
}

export interface CoachingPlaybook {
  id: string;
  kind: PlaybookKind;
  /** The latest version's `# title`, else its id. */
  title: string;
  archived: boolean;
  latest: PlaybookVersion;
  /** What the AI Coach is given in this environment; null when none (archived, or nothing Human-validated in production). */
  served: PlaybookVersion | null;
}

/** What the AI Coach uses, at the versions this environment serves. */
export interface ServedKnowledge {
  coreDigest: { version: number; content: string } | null;
  sources: { version: number; entries: Source[] } | null;
  playbooks: { id: string; title: string; version: number; content: string; agent: PlaybookAgent }[];
}

/** One version as the import writes it: version 1, by "import", not validated. */
export interface PlaybookSeed {
  sources: string;
  coreDigest: string;
  playbooks: { id: string; content: string; agent: PlaybookAgent }[];
}

/** Who saves a version: an Administrator, by the email they sign in with. */
export interface PlaybookEditor {
  email: string;
}

/** Who validates a version: a named Administrator. */
export interface PlaybookValidator {
  email: string;
  name: string;
}

type Refusal =
  /** The form is not usable: empty text, unknown effort, no description, a Sources list without a source or with one twice. */
  | { ok: false; error: "invalid" | "not_found" | "model_not_allowed" }
  /** Citations missing from the Sources list. */
  | { ok: false; error: "unknown_sources"; sources: string[] };

export type CreatePlaybookResult = { ok: true; version: PlaybookVersion } | Refusal | { ok: false; error: "exists" };

export type SavePlaybookResult =
  | { ok: true; before: PlaybookVersion; version: PlaybookVersion; newVersion: boolean }
  | Refusal
  | { ok: false; error: "unchanged" }
  /** The Sources list would lose Sources still cited: each with the Coaching Playbooks (or Core Digest) citing it. */
  | { ok: false; error: "sources_cited"; citedBy: { source: string; playbooks: string[] }[] };

export type ValidatePlaybookResult =
  | { ok: true; version: PlaybookVersion }
  | { ok: false; error: "not_found" | "not_latest" | "already_validated" | "own_version" };

export type ArchivePlaybookResult = { ok: true; changed: boolean } | { ok: false; error: "not_found" | "not_archivable" };

export interface CoachingPlaybooks {
  /** The Core Digest, the Sources list, then every Coaching Playbook by id, archived ones too. */
  list(): Promise<CoachingPlaybook[]>;
  /** One of them with all its versions, newest first; null when there is no such id. */
  history(id: string): Promise<{ playbook: CoachingPlaybook; versions: PlaybookVersion[] } | null>;
  /** A new Coaching Playbook at version 1. `input` is untrusted: { id, content, provider, model, effort, consultWhen }. */
  create(editor: PlaybookEditor, input: unknown, within?: Queryable): Promise<CreatePlaybookResult>;
  /**
   * Saves a version of `id`. `input` is untrusted: { content } for the Core Digest and the Sources list,
   * with { provider, model, effort, consultWhen } for a Coaching Playbook (model "" is the provider's default).
   */
  save(editor: PlaybookEditor, id: string, input: unknown, within?: Queryable): Promise<SavePlaybookResult>;
  /** Marks version `version` of `id` Human-validated by `validator`, now. */
  validate(validator: PlaybookValidator, id: string, version: number, within?: Queryable): Promise<ValidatePlaybookResult>;
  /** Archives a Coaching Playbook (no longer served, kept) or restores it. */
  setArchived(id: string, archived: boolean, within?: Queryable): Promise<ArchivePlaybookResult>;
  served(): Promise<ServedKnowledge>;
}

export interface CoachingPlaybooksDeps {
  serving: PlaybookServing;
  /** The providers and models a Playbook Agent may use (the AI layer's `agentModels`). */
  agentModels: () => AgentModelChoice[];
}

/** Creates the tables and, when there is no Coaching Playbook yet, imports `seed()` as version 1 of each. Safe to run repeatedly. */
export async function migrateCoachingPlaybooks(database: Pool, seed: () => PlaybookSeed): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS coaching_playbook (
      id text PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN (${PLAYBOOK_KINDS.map((kind) => `'${kind}'`).join(", ")})),
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS playbook_version (
      playbook_id text NOT NULL REFERENCES coaching_playbook (id),
      version integer NOT NULL CHECK (version > 0),
      content text NOT NULL,
      agent_provider text,
      agent_model text,
      agent_effort text,
      consult_when text,
      authors text[] NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      validated_by_name text,
      validated_by_email text,
      validated_at timestamptz,
      PRIMARY KEY (playbook_id, version)
    );
  `);
  await inTransaction(database, async (client) => {
    // One importer at a time: two migrations starting together import once.
    await client.query("LOCK TABLE coaching_playbook IN EXCLUSIVE MODE");
    const { rows } = await client.query("SELECT 1 FROM coaching_playbook LIMIT 1");
    if (rows.length > 0) return;
    const { sources, coreDigest, playbooks } = seed();
    const imported: { id: string; kind: PlaybookKind; content: string; agent: PlaybookAgent | null }[] = [
      { id: CORE_DIGEST, kind: "core_digest", content: coreDigest, agent: null },
      { id: SOURCES_LIST, kind: "sources", content: sources, agent: null },
      ...playbooks.map((playbook) => ({ ...playbook, kind: "playbook" as const })),
    ];
    for (const { id, kind, content, agent } of imported) {
      await client.query("INSERT INTO coaching_playbook (id, kind) VALUES ($1, $2)", [id, kind]);
      await insertVersion(client, id, 1, content, agent, [IMPORT_AUTHOR]);
    }
  });
}

interface VersionRow {
  playbook_id: string;
  version: number;
  content: string;
  agent_provider: string | null;
  agent_model: string | null;
  agent_effort: string | null;
  consult_when: string | null;
  authors: string[];
  created_at: Date;
  updated_at: Date;
  validated_by_name: string | null;
  validated_by_email: string | null;
  validated_at: Date | null;
}

const VERSION_COLUMNS = `v.playbook_id, v.version, v.content, v.agent_provider, v.agent_model, v.agent_effort, v.consult_when, v.authors,
  v.created_at, v.updated_at, v.validated_by_name, v.validated_by_email, v.validated_at`;

const versionFrom = (row: VersionRow): PlaybookVersion => ({
  playbookId: row.playbook_id,
  version: row.version,
  content: row.content,
  agent:
    row.agent_provider === null
      ? null
      : { provider: row.agent_provider as ProviderId, model: row.agent_model, effort: row.agent_effort as Effort, consultWhen: row.consult_when ?? "" },
  authors: row.authors,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  validation: row.validated_at ? { name: row.validated_by_name ?? "", email: row.validated_by_email ?? "", at: row.validated_at } : null,
});

async function insertVersion(within: Queryable, id: string, version: number, content: string, agent: PlaybookAgent | null, authors: string[]): Promise<PlaybookVersion> {
  const { rows } = await within.query<VersionRow>(
    `INSERT INTO playbook_version AS v (playbook_id, version, content, agent_provider, agent_model, agent_effort, consult_when, authors)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${VERSION_COLUMNS}`,
    [id, version, content, agent?.provider ?? null, agent?.model ?? null, agent?.effort ?? null, agent?.consultWhen ?? null, authors],
  );
  return versionFrom(rows[0]!);
}

/** A pool, as opposed to one client (which has `release`), possibly inside the caller's transaction. */
const isPool = (within: Queryable): within is Pool => typeof (within as Pool).connect === "function" && !("release" in within);

/** Runs `work` in a transaction of its own on a pool, or in the caller's when given a client. */
async function inTransaction<T>(within: Queryable, work: (client: Queryable) => Promise<T>): Promise<T> {
  if (!isPool(within)) return work(within);
  const client: PoolClient = await within.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 60;

const field = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
};

/** A version's text and, for a Coaching Playbook, its Playbook Agent, read from an untrusted form; null when unusable. */
function versionInput(kind: PlaybookKind, input: unknown): { content: string; agent: PlaybookAgent | null } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const fields = input as Record<string, unknown>;
  const content = field(fields, "content")?.replace(/\r\n/g, "\n").trim();
  if (!content || content.length > MAX_CONTENT_LENGTH) return null;
  if (kind !== "playbook") return { content, agent: null };
  const provider = field(fields, "provider");
  const effort = fields.effort;
  const consultWhen = field(fields, "consultWhen")?.trim();
  if (!provider || !(PROVIDER_IDS as readonly string[]).includes(provider) || !isEffort(effort)) return null;
  if (!consultWhen || consultWhen.length > MAX_CONSULT_WHEN_LENGTH) return null;
  const model = field(fields, "model")?.trim() || null;
  return { content, agent: { provider: provider as ProviderId, model, effort, consultWhen } };
}

const sameAgent = (a: PlaybookAgent | null, b: PlaybookAgent | null) =>
  a === b || (a !== null && b !== null && a.provider === b.provider && a.model === b.model && a.effort === b.effort && a.consultWhen === b.consultWhen);

const normalEmail = (email: string) => email.trim().toLowerCase();

export function createCoachingPlaybooks(database: Pool, deps: CoachingPlaybooksDeps): CoachingPlaybooks {
  const allowed = (agent: PlaybookAgent): boolean => {
    const choice = deps.agentModels().find((each) => each.provider === agent.provider);
    return choice !== undefined && (agent.model === null || choice.models.some((each) => each.model === agent.model));
  };

  /** The latest version of each, or of `id`. */
  async function latestVersions(within: Queryable, id?: string): Promise<Map<string, PlaybookVersion>> {
    const { rows } = await within.query<VersionRow>(
      `SELECT DISTINCT ON (v.playbook_id) ${VERSION_COLUMNS} FROM playbook_version v
        WHERE $1::text IS NULL OR v.playbook_id = $1 ORDER BY v.playbook_id, v.version DESC`,
      [id ?? null],
    );
    return new Map(rows.map((row) => [row.playbook_id, versionFrom(row)]));
  }

  /** The version served of each not archived, or of `id`. */
  async function servedVersions(within: Queryable, id?: string): Promise<Map<string, PlaybookVersion>> {
    const { rows } = await within.query<VersionRow>(
      `SELECT DISTINCT ON (v.playbook_id) ${VERSION_COLUMNS} FROM playbook_version v JOIN coaching_playbook p ON p.id = v.playbook_id
        WHERE p.archived_at IS NULL AND ($1::text IS NULL OR v.playbook_id = $1) AND ($2 = 'latest' OR v.validated_at IS NOT NULL)
        ORDER BY v.playbook_id, v.version DESC`,
      [id ?? null, deps.serving],
    );
    return new Map(rows.map((row) => [row.playbook_id, versionFrom(row)]));
  }

  async function playbooksOf(within: Queryable, id?: string): Promise<CoachingPlaybook[]> {
    const [{ rows }, latest, served] = await Promise.all([
      within.query<{ id: string; kind: PlaybookKind; archived: boolean }>(
        `SELECT id, kind, archived_at IS NOT NULL AS archived FROM coaching_playbook WHERE $1::text IS NULL OR id = $1
          ORDER BY array_position(ARRAY['core_digest', 'sources', 'playbook'], kind), id`,
        [id ?? null],
      ),
      latestVersions(within, id),
      servedVersions(within, id),
    ]);
    return rows.flatMap((row) => {
      const version = latest.get(row.id);
      if (!version) return [];
      return [{ ...row, title: markdownTitle(version.content) || row.id, latest: version, served: served.get(row.id) ?? null }];
    });
  }

  /** The `[Sn]` of `content` missing from the latest Sources list. */
  async function unknownSources(within: Queryable, content: string): Promise<string[]> {
    const sources = (await latestVersions(within, SOURCES_LIST)).get(SOURCES_LIST);
    const listed = new Set(parseSources(sources?.content ?? "").map((source) => source.id));
    return citedSourceIds(content).filter((id) => !listed.has(id));
  }

  /** The Sources of `removed` still cited by the served or latest version of the Core Digest or of a Coaching Playbook in use. */
  async function citedSources(within: Queryable, removed: string[]): Promise<{ source: string; playbooks: string[] }[]> {
    if (removed.length === 0) return [];
    const [latest, served, { rows: inUse }] = await Promise.all([
      latestVersions(within),
      servedVersions(within),
      within.query<{ id: string }>(`SELECT id FROM coaching_playbook WHERE archived_at IS NULL AND kind <> 'sources'`),
    ]);
    const ordered = inUse.map((row) => row.id).sort((a, b) => (a === CORE_DIGEST ? -1 : b === CORE_DIGEST ? 1 : a.localeCompare(b)));
    return removed.flatMap((source) => {
      const playbooks = ordered.filter((id) => [latest.get(id), served.get(id)].some((version) => version && citedSourceIds(version.content).includes(source)));
      return playbooks.length > 0 ? [{ source, playbooks }] : [];
    });
  }

  /** What makes `content` unusable as a Sources list, or the Sources it would drop that are still cited. */
  async function checkSourcesList(within: Queryable, content: string, previous: string): Promise<SavePlaybookResult | null> {
    const ids = parseSources(content).map((source) => source.id);
    if (ids.length === 0 || new Set(ids).size !== ids.length) return { ok: false, error: "invalid" };
    const removed = parseSources(previous)
      .map((source) => source.id)
      .filter((id) => !ids.includes(id));
    const citedBy = await citedSources(within, removed);
    return citedBy.length > 0 ? { ok: false, error: "sources_cited", citedBy } : null;
  }

  return {
    list: () => playbooksOf(database),

    async history(id) {
      const [playbook] = await playbooksOf(database, id);
      if (!playbook) return null;
      const { rows } = await database.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM playbook_version v WHERE v.playbook_id = $1 ORDER BY v.version DESC`, [id]);
      return { playbook, versions: rows.map(versionFrom) };
    },

    create(editor, input, within = database) {
      return inTransaction(within, async (client): Promise<CreatePlaybookResult> => {
        const id = typeof input === "object" && input !== null ? (input as Record<string, unknown>).id : undefined;
        if (typeof id !== "string" || !ID.test(id) || id.length > MAX_ID_LENGTH) return { ok: false, error: "invalid" };
        const parsed = versionInput("playbook", input);
        if (!parsed) return { ok: false, error: "invalid" };
        if (!allowed(parsed.agent!)) return { ok: false, error: "model_not_allowed" };
        const unknown = await unknownSources(client, parsed.content);
        if (unknown.length > 0) return { ok: false, error: "unknown_sources", sources: unknown };
        const { rows } = await client.query("INSERT INTO coaching_playbook (id, kind) VALUES ($1, 'playbook') ON CONFLICT (id) DO NOTHING RETURNING id", [id]);
        if (rows.length === 0) return { ok: false, error: "exists" };
        return { ok: true, version: await insertVersion(client, id, 1, parsed.content, parsed.agent, [normalEmail(editor.email)]) };
      });
    },

    save(editor, id, input, within = database) {
      return inTransaction(within, async (client): Promise<SavePlaybookResult> => {
        const { rows } = await client.query<{ kind: PlaybookKind }>("SELECT kind FROM coaching_playbook WHERE id = $1 FOR UPDATE", [id]);
        const kind = rows[0]?.kind;
        if (!kind) return { ok: false, error: "not_found" };
        const parsed = versionInput(kind, input);
        if (!parsed) return { ok: false, error: "invalid" };
        if (parsed.agent && !allowed(parsed.agent)) return { ok: false, error: "model_not_allowed" };
        const before = (await latestVersions(client, id)).get(id)!;
        if (before.content === parsed.content && sameAgent(before.agent, parsed.agent)) return { ok: false, error: "unchanged" };
        if (kind === "sources") {
          const refused = await checkSourcesList(client, parsed.content, before.content);
          if (refused) return refused;
        } else {
          const unknown = await unknownSources(client, parsed.content);
          if (unknown.length > 0) return { ok: false, error: "unknown_sources", sources: unknown };
        }
        const author = normalEmail(editor.email);
        if (before.validation) {
          return { ok: true, before, version: await insertVersion(client, id, before.version + 1, parsed.content, parsed.agent, [author]), newVersion: true };
        }
        const { rows: updated } = await client.query<VersionRow>(
          `UPDATE playbook_version v SET content = $3, agent_provider = $4, agent_model = $5, agent_effort = $6, consult_when = $7,
                  authors = CASE WHEN $8 = ANY(v.authors) THEN v.authors ELSE array_append(v.authors, $8) END, updated_at = clock_timestamp()
            WHERE v.playbook_id = $1 AND v.version = $2 RETURNING ${VERSION_COLUMNS}`,
          [id, before.version, parsed.content, parsed.agent?.provider ?? null, parsed.agent?.model ?? null, parsed.agent?.effort ?? null, parsed.agent?.consultWhen ?? null, author],
        );
        return { ok: true, before, version: versionFrom(updated[0]!), newVersion: false };
      });
    },

    validate(validator, id, version, within = database) {
      return inTransaction(within, async (client): Promise<ValidatePlaybookResult> => {
        const { rows } = await client.query("SELECT 1 FROM coaching_playbook WHERE id = $1 FOR UPDATE", [id]);
        const latest = rows.length > 0 ? (await latestVersions(client, id)).get(id) : undefined;
        if (!latest || !Number.isInteger(version) || version < 1 || version > latest.version) return { ok: false, error: "not_found" };
        if (version !== latest.version) return { ok: false, error: "not_latest" };
        if (latest.validation) return { ok: false, error: "already_validated" };
        const email = normalEmail(validator.email);
        if (latest.authors.includes(email)) return { ok: false, error: "own_version" };
        const { rows: validated } = await client.query<VersionRow>(
          `UPDATE playbook_version v SET validated_by_name = $3, validated_by_email = $4, validated_at = clock_timestamp()
            WHERE v.playbook_id = $1 AND v.version = $2 RETURNING ${VERSION_COLUMNS}`,
          [id, version, validator.name.trim() || email, email],
        );
        return { ok: true, version: versionFrom(validated[0]!) };
      });
    },

    async setArchived(id, archived, within = database) {
      const { rows } = await within.query<{ kind: PlaybookKind; was: boolean }>(
        `WITH was AS (SELECT kind, archived_at IS NOT NULL AS was FROM coaching_playbook WHERE id = $1),
              changed AS (
                UPDATE coaching_playbook SET archived_at = CASE WHEN $2 THEN clock_timestamp() END
                 WHERE id = $1 AND kind = 'playbook' AND (archived_at IS NOT NULL) <> $2 RETURNING 1
              )
         SELECT kind, was FROM was`,
        [id, archived],
      );
      if (!rows[0]) return { ok: false, error: "not_found" };
      if (rows[0].kind !== "playbook") return { ok: false, error: "not_archivable" };
      return { ok: true, changed: rows[0].was !== archived };
    },

    async served() {
      const [served, { rows }] = await Promise.all([
        servedVersions(database),
        database.query<{ id: string; kind: PlaybookKind }>("SELECT id, kind FROM coaching_playbook WHERE archived_at IS NULL ORDER BY id"),
      ]);
      const digest = served.get(CORE_DIGEST);
      const sources = served.get(SOURCES_LIST);
      return {
        coreDigest: digest ? { version: digest.version, content: digest.content } : null,
        sources: sources ? { version: sources.version, entries: parseSources(sources.content) } : null,
        playbooks: rows.flatMap((row) => {
          const version = served.get(row.id);
          if (row.kind !== "playbook" || !version?.agent) return [];
          return [{ id: row.id, title: markdownTitle(version.content) || row.id, version: version.version, content: version.content, agent: version.agent }];
        }),
      };
    },
  };
}

