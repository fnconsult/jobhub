/** Fiscal identity and immutable annual preparation. Raw identity never enters SQL/audit text; authority filing remains external. */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SecretCipher } from "../provider-secrets/cipher";
import { inTransaction, type Queryable } from "../database/pool";
import { mayReadEarnings } from "../coaching-earnings";
import { taxIdentitySchema, type TaxEvent, taxQuarters } from "./model";
import { taxOperatorSchema, type AnnualTaxDocument, type AnnualSeller, taxXml, taxFilename } from "./xml";
export interface TaxPayment {
  id: string;
  accountId: string;
  paymentIntent: string;
  amount: number;
  commission: number;
  currency: string;
  sellerId: string;
  sellerSiret?: string;
}
export interface TaxTransfer {
  id: string;
  batchId: string;
  sellerId: string;
  amount: number;
  currency: string;
  accountId: string;
  activities: number;
}
export interface TaxDeps {
  platformFacts?(transfer: TaxTransfer): Promise<TaxEvent[]>;
  cipher: SecretCipher | null;
  permitted(): Promise<boolean>;
  now?: () => Date;
  facts?(payment: TaxPayment): Promise<TaxEvent[]>;
  validateXml?(xml: string): Promise<boolean>;
  sendCopy?(notice: { to: string; locale: "fr" | "en"; reportId: string; sellerId: string; year: number }): Promise<void>;
}
interface SealedRow {
  year: number;
  sellerId?: string;
  id: string;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}
const yearOk = (year: number) => Number.isInteger(year) && year >= 2026 && year <= 2099;
const uuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const place = (row: string, name: string) => ({ provider: "coaching-tax", name, row });
export function coachingTaxes(database: Pool, deps: TaxDeps) {
  const now = deps.now ?? (() => new Date());
  const open = <T>(row: SealedRow, name: string): T => {
    if (!deps.cipher) throw Error("Fiscal encryption unavailable");
    if (!Number.isInteger(row.year) || (name === "identity" && !row.sellerId)) throw Error("Fiscal encrypted context missing");
    const binding = name === "identity" ? `identity:${row.sellerId}:${row.year}` : `annual:${row.year}`;
    return JSON.parse(deps.cipher.open(row, place(row.id, binding))) as T;
  };
  async function saved(sellerId: string, year: number, within: Queryable = database) {
    return (
      (
        await within.query<SealedRow & { createdAt: Date }>(
          `SELECT id,year,seller_id AS "sellerId",ciphertext,iv,tag,key_version AS "keyVersion",created_at AS "createdAt" FROM coaching_tax_identity WHERE seller_id=$1 AND year<=$2 AND year>=$2-3 ORDER BY year DESC,revision DESC,id DESC LIMIT 1`,
          [sellerId, year],
        )
      ).rows[0] ?? null
    );
  }
  async function mayUse(personId: string, sellerId: string, within: Queryable = database) {
    return uuid(sellerId) && (await mayReadEarnings(within, personId, sellerId));
  }
  return {
    async prepare(
      year: number,
      operatorInput: unknown,
      actorId: string,
      auditTransaction?: Queryable,
      replacement?: { replaceId: string; confirmedUnfiled: boolean },
    ) {
      const operator = taxOperatorSchema.safeParse(operatorInput);
      if (
        year !== 2026 ||
        !yearOk(year) ||
        !operator.success ||
        year >= Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(now())) ||
        !deps.cipher ||
        !deps.facts ||
        !(await deps.permitted())
      )
        throw Error("Fiscal preparation unavailable");
      const existing = (
        await database.query<SealedRow>(
          `SELECT id,year,ciphertext,iv,tag,key_version AS "keyVersion" FROM coaching_tax_report WHERE year=$1 AND superseded_at IS NULL`,
          [year],
        )
      ).rows[0];
      if (existing && !replacement) return { document: open<AnnualTaxDocument>(existing, "annual"), created: false };
      if (replacement && (!replacement.confirmedUnfiled || !uuid(replacement.replaceId) || existing?.id !== replacement.replaceId))
        throw Error("Unfiled replacement confirmation or current revision required");
      const id = randomUUID(),
        sellers: AnnualSeller[] = [],
        cutoff = new Date(Date.UTC(year, 11, 31, 23));
      const sources = (
        await database.query<TaxPayment & { profileId: string }>(
          `SELECT p.id,p.account_id AS "accountId",p.payment_intent AS "paymentIntent",p.amount,p.commission,p.currency,(p.sale_snapshot->'seller'->>'id') AS "sellerId",p.sale_snapshot->'seller'->>'siret' AS "sellerSiret" FROM coaching_connect_payment p WHERE p.paid_at IS NOT NULL AND p.payment_intent IS NOT NULL AND p.account_id IS NOT NULL AND p.sale_snapshot->'seller'->>'kind'<>'jobbbox' AND p.created_at<$1 ORDER BY p.recipient_id,p.id`,
          [cutoff],
        )
      ).rows;
      const transfers = (
        await database.query<TaxTransfer>(
          `SELECT b.id,b.id AS "batchId",b.seller_id AS "sellerId",b.transfer_id AS "transferId",b.transfer_amount AS amount,b.currency,b.account_id AS "accountId",b.transfer_outcome AS "transferOutcome",b.created_at AS "createdAt" FROM coaching_connect_batch b WHERE b.transfer_amount<>0 AND b.created_at<$1 ORDER BY b.created_at,b.id`,
          [cutoff],
        )
      ).rows as (TaxTransfer & { transferId: string | null; transferOutcome: string; createdAt: Date })[];
      if (transfers.some((row) => row.createdAt < new Date(Date.UTC(year, 11, 31, 23)) && row.transferOutcome === "unknown"))
        throw Error("Unresolved platform transfer prevents fiscal preparation");
      const platformEvents = new Map<string, TaxEvent[]>(),
        seenActivities = new Set<string>();
      for (const transfer of transfers) {
        if (!transfer.transferId || transfer.amount <= 0 || transfer.transferId.startsWith("reversal:")) continue;
        if (!deps.platformFacts) throw Error("Platform compensation reader unavailable");
        const allocations = (
          await database.query<{ id: string }>(
            `SELECT p.id FROM coaching_connect_allocation a JOIN coaching_connect_payment p ON p.id=a.payment_id WHERE a.batch_id=$1 AND a.amount>0 AND p.sale_snapshot->'seller'->>'kind'='jobbbox' ORDER BY p.id`,
            [transfer.batchId],
          )
        ).rows;
        transfer.activities = allocations.filter((row) => {
          if (seenActivities.has(row.id)) return false;
          seenActivities.add(row.id);
          return true;
        }).length;
        const facts = await deps.platformFacts({ ...transfer, id: transfer.transferId });
        platformEvents.set(transfer.sellerId, [...(platformEvents.get(transfer.sellerId) ?? []), ...facts]);
      }
      for (const sellerId of [...new Set([...sources.map((p) => p.sellerId), ...platformEvents.keys()])]) {
        const payments = sources.filter((p) => p.sellerId === sellerId),
          events: TaxEvent[] = [...(platformEvents.get(sellerId) ?? [])];
        for (const payment of payments) events.push(...(await deps.facts(payment)));
        const start = new Date(Date.UTC(year - 1, 11, 31, 23)),
          end = new Date(Date.UTC(year, 11, 31, 23));
        if (!events.some((event) => event.at >= start && event.at < end)) continue;
        const profile = await saved(sellerId, year);
        if (!profile) throw Error("Seller fiscal identity incomplete");
        const identity = taxIdentitySchema.parse(open(profile, "identity"));
        if (identity.residence !== "FR" || identity.addressCountry !== "FR" || identity.tinCountry !== "FR" || identity.permanentEstablishments.length)
          throw Error("Cross-border fiscal identity requires operator review");
        if (payments.some((payment) => payment.sellerSiret !== identity.siret)) throw Error("Frozen Seller fiscal identity mismatch");
        const payouts = (
          await database.query<{ at: Date; amount: number; currency: string }>(
            `SELECT b.paid_at AS at,sum(a.amount)::integer AS amount,b.currency FROM coaching_connect_batch b JOIN coaching_connect_allocation a ON a.batch_id=b.id JOIN coaching_connect_payment p ON p.id=a.payment_id WHERE b.seller_id=$1 AND b.state='paid' AND ((p.sale_snapshot->'seller'->>'kind'='jobbbox' AND p.recipient_id=$1) OR p.sale_snapshot->'seller'->>'id'=$1::text) GROUP BY b.id ORDER BY b.paid_at,b.id`,
            [sellerId],
          )
        ).rows;
        sellers.push({ sellerId, docRefId: `OP_${year}_${operator.data.tin}_${randomUUID()}`, identity, quarters: taxQuarters(year, events, payouts) });
      }
      if (!sellers.length) throw Error("No reportable Seller; use the official nil-return procedure");
      const document: AnnualTaxDocument = {
        id,
        year,
        createdAt: now().toISOString(),
        operator: operator.data,
        sellers,
        schemaVersion: "DGFiP-2026-v1.7",
        fileSequence: 0,
      };
      const valid = (await deps.validateXml?.(taxXml(document))) ?? false;
      const sealed = deps.cipher.seal(JSON.stringify(document), place(id, `annual:${year}`));
      const persist = async (within: Queryable) => {
        await within.query("SELECT pg_advisory_xact_lock(hashtextextended($1,887))", ["fiscal-year:" + year]);
        if (replacement) {
          const copies = (
            await within.query<{ sellerId: string }>('SELECT seller_id AS "sellerId" FROM coaching_tax_copy WHERE report_id=$1 ORDER BY seller_id', [
              replacement.replaceId,
            ])
          ).rows;
          for (const copy of copies)
            await within.query("SELECT pg_advisory_xact_lock(hashtextextended($1,887))", [replacement.replaceId + ":" + copy.sellerId]);
          const changed = await within.query("UPDATE coaching_tax_report SET superseded_at=$3 WHERE id=$1 AND year=$2 AND superseded_at IS NULL", [
            replacement.replaceId,
            year,
            now(),
          ]);
          if (!changed.rowCount) throw Error("Fiscal preparation changed concurrently");
        }
        const result = await within.query(
          `INSERT INTO coaching_tax_report(id,year,created_by,created_at,ciphertext,iv,tag,key_version,schema_valid) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(year) WHERE superseded_at IS NULL DO NOTHING RETURNING id`,
          [id, year, actorId, now(), sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion, valid],
        );
        if (!result.rowCount) return false;
        for (const seller of sellers) await within.query(`INSERT INTO coaching_tax_copy(report_id,seller_id) VALUES($1,$2)`, [id, seller.sellerId]);
        return true;
      };
      const inserted = auditTransaction ? await persist(auditTransaction) : await inTransaction(database, persist);
      if (inserted) return { document, created: true };
      const found = (
        await database.query<SealedRow>(
          `SELECT id,year,ciphertext,iv,tag,key_version AS "keyVersion" FROM coaching_tax_report WHERE year=$1 AND superseded_at IS NULL`,
          [year],
        )
      ).rows[0]!;
      return { document: open<AnnualTaxDocument>(found, "annual"), created: false };
    },
    async annual(id: string) {
      if (!uuid(id) || !deps.cipher) return null;
      const row = (
        await database.query<SealedRow & { schemaValid: boolean; supersededAt: Date | null }>(
          `SELECT id,year,ciphertext,iv,tag,key_version AS "keyVersion",schema_valid AS "schemaValid",superseded_at AS "supersededAt" FROM coaching_tax_report WHERE id=$1`,
          [id],
        )
      ).rows[0];
      if (!row) return null;
      const document = open<AnnualTaxDocument>(row, "annual");
      return { document, schemaValid: row.schemaValid, supersededAt: row.supersededAt, xml: taxXml(document), filename: taxFilename(document) };
    },
    async sellerCopy(personId: string, reportId: string, sellerId: string) {
      if (!uuid(reportId) || !deps.cipher || !(await mayUse(personId, sellerId))) return null;
      const row = (
        await database.query<SealedRow & { supersededAt: Date | null }>(
          `SELECT id,year,ciphertext,iv,tag,key_version AS "keyVersion",superseded_at AS "supersededAt" FROM coaching_tax_report WHERE id=$1`,
          [reportId],
        )
      ).rows[0];
      if (!row) return null;
      const document = open<AnnualTaxDocument>(row, "annual"),
        seller = document.sellers.find((s) => s.sellerId === sellerId);
      return seller ? { year: document.year, createdAt: document.createdAt, seller, supersededAt: row.supersededAt } : null;
    },
    async reportsFor(personId: string, sellerId: string) {
      if (!(await mayUse(personId, sellerId))) return [];
      return (
        await database.query<{ id: string; year: number; createdAt: Date }>(
          `SELECT r.id,r.year,r.created_at AS "createdAt" FROM coaching_tax_report r JOIN coaching_tax_copy c ON c.report_id=r.id WHERE c.seller_id=$1 AND r.superseded_at IS NULL ORDER BY r.year DESC`,
          [sellerId],
        )
      ).rows;
    },
    async list() {
      return (
        await database.query<{ id: string; year: number; createdAt: Date; schemaValid: boolean; supersededAt: Date | null }>(
          `SELECT id,year,created_at AS "createdAt",schema_valid AS "schemaValid",superseded_at AS "supersededAt" FROM coaching_tax_report ORDER BY year DESC,created_at DESC`,
        )
      ).rows;
    },
    async deliverCopies() {
      if (!deps.sendCopy || !deps.cipher) return;
      const due = (
        await database.query<{ reportId: string; sellerId: string; year: number }>(
          `SELECT c.report_id AS "reportId",c.seller_id AS "sellerId",r.year FROM coaching_tax_copy c JOIN coaching_tax_report r ON r.id=c.report_id WHERE r.schema_valid AND r.superseded_at IS NULL AND c.sent_at IS NULL AND (c.retry_at IS NULL OR c.retry_at<=$1) ORDER BY r.created_at,c.seller_id LIMIT 100`,
          [now()],
        )
      ).rows;
      for (const item of due) {
        const key = item.reportId + ":" + item.sellerId,
          within = await database.connect();
        try {
          if (!(await within.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,887)) AS locked", [key])).rows[0]?.locked) continue;
          const pending = (
            await within.query(
              "SELECT 1 FROM coaching_tax_copy c JOIN coaching_tax_report r ON r.id=c.report_id WHERE c.report_id=$1 AND c.seller_id=$2 AND c.sent_at IS NULL AND (c.retry_at IS NULL OR c.retry_at<=$3) AND r.schema_valid AND r.superseded_at IS NULL",
              [item.reportId, item.sellerId, now()],
            )
          ).rowCount;
          if (!pending) continue;
          try {
            const person = (
              await within.query<{ id: string; email: string; locale: "fr" | "en" }>(
                `SELECT c.id,c.email,coalesce(c."interfaceLanguage",'fr') AS locale FROM coaching_seller s LEFT JOIN coaching_connect_account k ON k.seller_id=s.id JOIN candidate c ON c."emailVerified" AND ((s.kind='human_coach' AND c.id=k.owner_id) OR (s.kind='association' AND EXISTS(SELECT 1 FROM coach_association_manager m WHERE m.association_id=s.association_id AND m.candidate_id=c.id))) WHERE s.id=$1 ORDER BY c.id LIMIT 1`,
                [item.sellerId],
              )
            ).rows[0];
            if (!person) throw Error("Verified fiscal recipient unavailable");
            await deps.sendCopy({ ...item, to: person.email, locale: person.locale });
            await within.query("UPDATE coaching_tax_copy SET sent_at=$3,retry_at=NULL,recipient_id=$4 WHERE report_id=$1 AND seller_id=$2", [
              item.reportId,
              item.sellerId,
              now(),
              person.id,
            ]);
          } catch {
            await within.query("UPDATE coaching_tax_copy SET retry_at=$3 WHERE report_id=$1 AND seller_id=$2", [
              item.reportId,
              item.sellerId,
              new Date(+now() + 300000),
            ]);
          }
        } finally {
          try {
            await within.query("SELECT pg_advisory_unlock(hashtextextended($1,887))", [key]);
          } finally {
            within.release();
          }
        }
      }
    },
    async purge() {
      const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(now())) - 10;
      await database.query("DELETE FROM coaching_tax_report WHERE year<$1", [year]);
      await database.query("DELETE FROM coaching_tax_identity WHERE year<$1", [year]);
    },
    async validate(id: string, within: Queryable = database) {
      if (!uuid(id) || !deps.cipher || !deps.validateXml) return false;
      const row = (await within.query<SealedRow>(`SELECT id,year,ciphertext,iv,tag,key_version AS "keyVersion" FROM coaching_tax_report WHERE id=$1`, [id]))
        .rows[0];
      if (!row) return false;
      const valid = await deps.validateXml(taxXml(open<AnnualTaxDocument>(row, "annual")));
      await within.query("UPDATE coaching_tax_report SET schema_valid=$2 WHERE id=$1", [id, valid]);
      return valid;
    },
    async reencrypt() {
      if (!deps.cipher) return 0;
      let count = 0;
      for (const [table, name] of [
        ["coaching_tax_identity", "identity"],
        ["coaching_tax_report", "annual"],
      ] as const) {
        const rows = (
          await database.query<SealedRow>(
            `SELECT id,year,${name === "identity" ? 'seller_id AS "sellerId",' : ""}ciphertext,iv,tag,key_version AS "keyVersion" FROM ${table} WHERE key_version<>$1`,
            [deps.cipher.activeVersion],
          )
        ).rows;
        for (const row of rows) {
          const binding = name === "identity" ? `identity:${row.sellerId}:${row.year}` : `annual:${row.year}`,
            value = deps.cipher.open(row, place(row.id, binding)),
            sealed = deps.cipher.seal(value, place(row.id, binding));
          count +=
            (
              await database.query(`UPDATE ${table} SET ciphertext=$2,iv=$3,tag=$4,key_version=$5 WHERE id=$1 AND key_version=$6`, [
                row.id,
                sealed.ciphertext,
                sealed.iv,
                sealed.tag,
                sealed.keyVersion,
                row.keyVersion,
              ])
            ).rowCount ?? 0;
        }
      }
      return count;
    },
    async ready(sellerId: string, year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(now()))) {
      if (!yearOk(year) || !uuid(sellerId) || !deps.cipher || !(await deps.permitted())) return false;
      const row = await saved(sellerId, year);
      if (!row) return false;
      try {
        const identity = taxIdentitySchema.safeParse(open(row, "identity"));
        if (!identity.success) return false;
        if (
          identity.data.residence !== "FR" ||
          identity.data.addressCountry !== "FR" ||
          identity.data.tinCountry !== "FR" ||
          identity.data.permanentEstablishments.length
        )
          return false;
        const expiry = new Date(row.createdAt);
        expiry.setUTCFullYear(expiry.getUTCFullYear() + 3);
        if (row.createdAt > now() || expiry <= now()) return false;
        return (await database.query("SELECT 1 FROM coaching_seller WHERE id=$1 AND siret=$2", [sellerId, identity.data.siret])).rowCount === 1;
      } catch {
        return false;
      }
    },
    async identity(personId: string, sellerId: string, year: number) {
      if (!yearOk(year) || !deps.cipher || !(await mayUse(personId, sellerId))) return null;
      const row = await saved(sellerId, year);
      if (!row) return null;
      return { id: row.id, identity: taxIdentitySchema.parse(open(row, "identity")) };
    },
    async saveIdentity(personId: string, sellerId: string, year: number, input: unknown) {
      const parsed = taxIdentitySchema.safeParse(input);
      if (!yearOk(year) || !parsed.success || !deps.cipher || !(await deps.permitted())) return false;
      if (
        year > Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(now())) ||
        (parsed.data.birthDate && new Date(parsed.data.birthDate) > now())
      )
        return false;
      return inTransaction(database, async (within) => {
        if (!(await mayUse(personId, sellerId, within))) return false;
        const seller = (await within.query<{ siret: string; kind: string }>("SELECT siret,kind FROM coaching_seller WHERE id=$1 FOR UPDATE", [sellerId]))
          .rows[0];
        const known =
          seller?.siret === parsed.data.siret ||
          Boolean(
            (
              await within.query(
                `SELECT 1 FROM coaching_connect_payment p WHERE p.recipient_id=$1 AND (p.sale_snapshot->'seller'->>'siret'=$2 OR p.payee_snapshot->>'siret'=$2) LIMIT 1`,
                [sellerId, parsed.data.siret],
              )
            ).rowCount,
          );
        if (!seller || seller.kind === "jobbbox" || !known || (seller.kind === "association" && parsed.data.kind !== "entity")) return false;
        const id = randomUUID(),
          sealed = deps.cipher!.seal(JSON.stringify(parsed.data), place(id, `identity:${sellerId}:${year}`));
        await within.query(
          "INSERT INTO coaching_tax_identity(id,seller_id,year,owner_id,ciphertext,iv,tag,key_version,created_at,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT coalesce(max(revision),0)+1 FROM coaching_tax_identity WHERE seller_id=$2 AND year=$3))",
          [id, sellerId, year, personId, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyVersion, now()],
        );
        return true;
      });
    },
  };
}
export async function migrateCoachingTaxes(database: Queryable) {
  await database.query(`
 CREATE TABLE IF NOT EXISTS coaching_tax_identity(id uuid PRIMARY KEY,seller_id uuid NOT NULL REFERENCES coaching_seller(id),year integer NOT NULL CHECK(year BETWEEN 2026 AND 2099),owner_id text REFERENCES candidate(id) ON DELETE SET NULL,ciphertext bytea NOT NULL,iv bytea NOT NULL,tag bytea NOT NULL,key_version integer NOT NULL,created_at timestamptz NOT NULL,revision integer NOT NULL,UNIQUE(seller_id,year,revision));
 ALTER TABLE coaching_tax_identity ADD COLUMN IF NOT EXISTS revision integer;
 WITH numbered AS(SELECT id,row_number() OVER(PARTITION BY seller_id,year ORDER BY created_at,id)::integer AS n FROM coaching_tax_identity) UPDATE coaching_tax_identity t SET revision=numbered.n FROM numbered WHERE t.id=numbered.id AND t.revision IS NULL;
 ALTER TABLE coaching_tax_identity ALTER COLUMN revision SET NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS coaching_tax_identity_revision ON coaching_tax_identity(seller_id,year,revision);
 CREATE INDEX IF NOT EXISTS coaching_tax_identity_latest ON coaching_tax_identity(seller_id,year,created_at DESC);
 CREATE TABLE IF NOT EXISTS coaching_tax_report(id uuid PRIMARY KEY,year integer NOT NULL,created_by text REFERENCES candidate(id) ON DELETE SET NULL,created_at timestamptz NOT NULL,ciphertext bytea NOT NULL,iv bytea NOT NULL,tag bytea NOT NULL,key_version integer NOT NULL,schema_valid boolean NOT NULL DEFAULT false,superseded_at timestamptz);
 ALTER TABLE coaching_tax_report ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
 ALTER TABLE coaching_tax_report DROP CONSTRAINT IF EXISTS coaching_tax_report_year_key;
 CREATE UNIQUE INDEX IF NOT EXISTS coaching_tax_active_year ON coaching_tax_report(year) WHERE superseded_at IS NULL;
 CREATE TABLE IF NOT EXISTS coaching_tax_copy(report_id uuid NOT NULL REFERENCES coaching_tax_report(id) ON DELETE CASCADE,seller_id uuid NOT NULL REFERENCES coaching_seller(id),recipient_id text REFERENCES candidate(id) ON DELETE SET NULL,sent_at timestamptz,retry_at timestamptz,PRIMARY KEY(report_id,seller_id));
`);
}
/** Account export respects current business ownership; former managers get only facts about their own submissions/deliveries. */
export async function taxDataOf(database: Queryable, candidateId: string, cipher: SecretCipher | null) {
  const sellers = (await database.query<{ id: string }>("SELECT id FROM coaching_seller WHERE kind<>'jobbbox'")).rows,
    allowed: string[] = [];
  for (const seller of sellers) if (await mayReadEarnings(database, candidateId, seller.id)) allowed.push(seller.id);
  const profiles = (
    await database.query<SealedRow & { sellerId: string; year: number; createdAt: Date }>(
      `SELECT id,seller_id AS "sellerId",year,created_at AS "createdAt",ciphertext,iv,tag,key_version AS "keyVersion" FROM coaching_tax_identity WHERE seller_id=ANY($1::uuid[]) ORDER BY year,id`,
      [allowed],
    )
  ).rows;
  const reports = (
    await database.query<SealedRow & { year: number; createdAt: Date; supersededAt: Date | null }>(
      `SELECT DISTINCT r.id,r.year,r.created_at AS "createdAt",r.superseded_at AS "supersededAt",r.ciphertext,r.iv,r.tag,r.key_version AS "keyVersion" FROM coaching_tax_report r JOIN coaching_tax_copy c ON c.report_id=r.id WHERE c.seller_id=ANY($1::uuid[]) ORDER BY r.year,r.id`,
      [allowed],
    )
  ).rows;
  if ((profiles.length || reports.length) && !cipher) throw Error("Fiscal export encryption key unavailable");
  const identities = profiles.map((row) => ({
    id: row.id,
    sellerId: row.sellerId,
    year: row.year,
    createdAt: row.createdAt,
    identity: taxIdentitySchema.parse(JSON.parse(cipher!.open(row, place(row.id, `identity:${row.sellerId}:${row.year}`)))),
  }));
  const annual = reports.map((row) => {
    const document = JSON.parse(cipher!.open(row, place(row.id, `annual:${row.year}`))) as AnnualTaxDocument;
    return {
      id: row.id,
      year: row.year,
      createdAt: row.createdAt,
      supersededAt: row.supersededAt,
      sellers: document.sellers.filter((s) => allowed.includes(s.sellerId)),
    };
  });
  const submissions = (
    await database.query(
      'SELECT id,seller_id AS "sellerId",year,created_at AS "createdAt" FROM coaching_tax_identity WHERE owner_id=$1 ORDER BY created_at,id',
      [candidateId],
    )
  ).rows;
  const deliveries = (
    await database.query(
      'SELECT report_id AS "reportId",seller_id AS "sellerId",sent_at AS "sentAt" FROM coaching_tax_copy WHERE recipient_id=$1 ORDER BY sent_at',
      [candidateId],
    )
  ).rows;
  const preparations = (
    await database.query(
      'SELECT id,year,created_at AS "createdAt",schema_valid AS "schemaValid",superseded_at AS "supersededAt" FROM coaching_tax_report WHERE created_by=$1 ORDER BY created_at,id',
      [candidateId],
    )
  ).rows;
  return { identities, annual, submissions, deliveries, preparations };
}
