import { utcBefore } from "../database/before";
/** Private, versioned B2B acceptance. No contract version is invented here: an empty registry closes the gate. */
import { createHmac } from "node:crypto";
import { legalTextRegistry, legalTextVersions, parisDay, legalNoticesDue, type LegalTextVersionRecord, type LegalTextVersion } from "@jobhub/help";
import type { Pool } from "pg";
import { inTransaction, type Queryable } from "../database/pool";
export interface ContractPerson {
  email: string;
  emailVerified: boolean;
}
export interface ContractActor {
  kind: "coach" | "association";
  id: string;
  name: string;
  candidateId: string;
}
export interface ContractAcceptance {
  kind: string;
  subjectId: string;
  version: string;
  url: string;
  sha256: string;
  acceptedAt: Date;
  origin: "web" | "mobile";
}
export interface ContractDeps {
  /** Only acceptance writers need AUTH_SECRET; the notice/purge Worker has no signing capability. */
  secret?: string;
  registry?: () => readonly LegalTextVersionRecord[];
  written?: () => readonly LegalTextVersion[];
  now?: () => Date;
  production?: boolean;
  sendNotice?: (recipient: { email: string; locale: string }, version: LegalTextVersion) => Promise<void>;
}
const UUID = /^[0-9a-f-]{36}$/i;
export const CONTRACT_PROOF_YEARS = 5;
export function coachContracts(database: Pool, deps: ContractDeps) {
  const registry = deps.registry ?? legalTextRegistry,
    now = deps.now ?? (() => new Date());
  const versions = () =>
    registry()
      .filter((v) => v.text === "contrat-coach" && v.version <= parisDay(now()))
      .sort((a, b) => a.version.localeCompare(b.version));
  async function actors(person: ContractPerson, within: Queryable = database): Promise<ContractActor[]> {
    if (!person.emailVerified) return [];
    const { rows } = await within.query<ContractActor>(
      `SELECT 'coach' AS kind,h.id,h.name,c.id AS "candidateId" FROM human_coach h JOIN candidate c ON lower(c.email)=h.email WHERE lower(c.email)=$1 AND h.retired_at IS NULL
      UNION ALL SELECT 'association',a.id,a.name,c.id FROM coach_association a JOIN coach_association_manager m ON m.association_id=a.id JOIN candidate c ON c.id=m.candidate_id WHERE lower(c.email)=$1 AND a.retired_at IS NULL`,
      [person.email.trim().toLowerCase()],
    );
    return rows;
  }
  async function state(person: ContractPerson, kind: unknown, id: string, within: Queryable = database) {
    const actor = (await actors(person, within)).find((x) => x.kind === kind && x.id === id);
    if (!actor) return null;
    const available = versions(),
      current = available.at(-1) ?? null;
    const history = (
      await within.query<ContractAcceptance>(
        `SELECT kind,subject_id AS "subjectId",version,url,sha256,accepted_at AS "acceptedAt",origin FROM coach_contract_acceptance WHERE candidate_id=$1 AND kind=$2 AND subject_id=$3 ORDER BY accepted_at DESC,id DESC`,
        [actor.candidateId, actor.kind, actor.id],
      )
    ).rows;
    const required = available.filter((v, index) => index === 0 || v.change === "substantielle").at(-1);
    // Compare fingerprints with the build's immutable registry as well as version ids.
    const accepted =
      !!required && history.some((a) => a.version >= required.version && available.some((v) => v.version === a.version && v.sha256 === a.sha256));
    return { actor, current, history, accepted };
  }
  return {
    actors,
    state,
    async mayEnter(person: ContractPerson, coachId: string) {
      return (await state(person, "coach", coachId))?.accepted === true;
    },
    async accept(person: ContractPerson, kind: unknown, id: string, version: unknown, sha256: unknown, origin: unknown = "web") {
      if (!deps.secret) throw new Error("Contract acceptance requires AUTH_SECRET");
      const secret = deps.secret;
      if (!UUID.test(id) || !(origin === "web" || origin === "mobile")) return false;
      return inTransaction(database, async (within) => {
        const record = await state(person, kind, id, within);
        if (!record?.current || record.current.version !== version || record.current.sha256 !== sha256) return false;
        const actor = record.actor;
        const table = actor.kind === "coach" ? "human_coach" : "coach_association";
        // Lock the business identity against retirement while recording the proof and activating it.
        if (!(await within.query(`SELECT id FROM ${table} WHERE id=$1 AND retired_at IS NULL FOR UPDATE`, [id])).rowCount) return false;
        const holder = createHmac("sha256", secret).update(`coach-contract:${person.email.trim().toLowerCase()}`).digest("hex");
        await within.query(
          `INSERT INTO coach_contract_acceptance(candidate_id,holder,kind,subject_id,version,url,sha256,origin,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(candidate_id,kind,subject_id,version) DO NOTHING`,
          [actor.candidateId, holder, actor.kind, id, version, record.current.url, sha256, origin, now()],
        );
        await within.query(`UPDATE ${table} SET contract_pending=false WHERE id=$1`, [id]);
        return true;
      });
    },
    async sendNotices() {
      if (!deps.production || !deps.sendNotice) return { sent: 0, failed: 0 };
      let sent = 0,
        failed = 0;
      for (const version of legalNoticesDue(parisDay(now()), deps.written?.() ?? legalTextVersions("fr")).filter((v) => v.text === "contrat-coach")) {
        const recipients = (
          await database.query<{ email: string; locale: string }>(
            `SELECT DISTINCT c.email,COALESCE(c."interfaceLanguage",'fr') AS locale FROM candidate c WHERE c."emailVerified" AND (EXISTS(SELECT 1 FROM human_coach h WHERE h.email=lower(c.email) AND h.retired_at IS NULL) OR EXISTS(SELECT 1 FROM coach_association_manager m JOIN coach_association a ON a.id=m.association_id WHERE m.candidate_id=c.id AND a.retired_at IS NULL)) ORDER BY c.email`,
          )
        ).rows;
        for (const recipient of recipients)
          try {
            await inTransaction(database, async (within) => {
              const claimed = await within.query(
                `INSERT INTO coach_contract_notice(candidate_id,version,sent_at) SELECT id,$2,$3 FROM candidate WHERE email=$1 ON CONFLICT DO NOTHING RETURNING candidate_id`,
                [recipient.email, version.effective, now()],
              );
              if (claimed.rowCount) {
                await deps.sendNotice!(recipient, version);
                sent++;
              }
            });
          } catch {
            failed++;
          }
      }
      return { sent, failed };
    },
    async purge() {
      return (
        (
          await database.query(
            `DELETE FROM coach_contract_acceptance WHERE candidate_id IS NULL AND account_deleted_at<${utcBefore("$1", "make_interval(years=>$2)")}`,
            [now(), CONTRACT_PROOF_YEARS],
          )
        ).rowCount ?? 0
      );
    },
  };
}
export async function coachContractAcceptancesOf(database: Queryable, candidateId: string) {
  return (
    await database.query<ContractAcceptance>(
      `SELECT kind,subject_id AS "subjectId",version,url,sha256,origin,accepted_at AS "acceptedAt" FROM coach_contract_acceptance WHERE candidate_id=$1 ORDER BY accepted_at,id`,
      [candidateId],
    )
  ).rows;
}
export async function coachContractNoticesOf(database: Queryable, candidateId: string) {
  return (
    await database.query<{ version: string; sentAt: Date }>(
      `SELECT version,sent_at AS "sentAt" FROM coach_contract_notice WHERE candidate_id=$1 ORDER BY sent_at,version`,
      [candidateId],
    )
  ).rows;
}
export async function migrateCoachContracts(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS coach_contract_acceptance(id bigserial PRIMARY KEY,candidate_id text REFERENCES candidate(id) ON DELETE SET NULL,holder text NOT NULL,kind text NOT NULL CHECK(kind IN ('coach','association')),subject_id uuid NOT NULL,version text NOT NULL,url text NOT NULL,sha256 text NOT NULL,origin text NOT NULL CHECK(origin IN ('web','mobile')),accepted_at timestamptz NOT NULL,account_deleted_at timestamptz,UNIQUE(candidate_id,kind,subject_id,version));
  CREATE TABLE IF NOT EXISTS coach_contract_notice(candidate_id text NOT NULL REFERENCES candidate(id) ON DELETE CASCADE,version text NOT NULL,sent_at timestamptz NOT NULL,PRIMARY KEY(candidate_id,version));
  CREATE OR REPLACE FUNCTION coach_contract_account_deleted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.candidate_id IS NOT NULL AND NEW.candidate_id IS NULL THEN NEW.account_deleted_at=clock_timestamp(); END IF; RETURN NEW; END $$;
  DROP TRIGGER IF EXISTS coach_contract_account_deleted ON coach_contract_acceptance;
  CREATE TRIGGER coach_contract_account_deleted BEFORE UPDATE OF candidate_id ON coach_contract_acceptance FOR EACH ROW EXECUTE FUNCTION coach_contract_account_deleted();`);
}

export { coachContractNoticeEmail } from "./email";
