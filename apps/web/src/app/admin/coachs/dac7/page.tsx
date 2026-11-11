import { redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getServerT } from "@/i18n/server";
import { Field, TextInput, Checkbox } from "@/design/Field";
import { getCoachingTaxes } from "@/coaching-tax/server";
import { taxLegalReady } from "@/coaching-tax/legal";
import { officialFiscalSchemaAvailable } from "@/coaching-tax/schema";
const FIELDS = ["legalName", "tin", "platformName", "street", "postalCode", "city", "vat"] as const;
const YEAR = "year",
  ID = "id",
  PATH = "/admin/coachs/dac7",
  REPLACE = "replaceId",
  UNFILED = "confirmedUnfiled";
async function prepare(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write");
  const replaceId = String(form.get(REPLACE) ?? ""),
    replacement = replaceId ? { replaceId, confirmedUnfiled: form.get(UNFILED) === "on" } : undefined;
  try {
    await getBackOffice().record(
      administrator,
      (within) =>
        getCoachingTaxes().prepare(
          Number(form.get(YEAR)),
          Object.fromEntries(FIELDS.map((name) => [name, form.get(name) ?? ""])),
          administrator.id,
          within,
          replacement,
        ),
      (change) =>
        change.created
          ? {
              section: "human_coaches",
              target: change.document.id,
              action: "added",
              before: replacement ? { replacedReportId: replacement.replaceId } : null,
              after: {
                fiscalYear: change.document.year,
                reportState: "prepared",
                sellerCount: change.document.sellers.length,
                schemaVersion: change.document.schemaVersion,
                confirmedUnfiledReplacement: Boolean(replacement),
              },
            }
          : null,
    );
    await getCoachingTaxes().deliverCopies();
  } catch {
    redirect(`${PATH}?error=preparation`);
  }
  redirect(PATH);
}
async function validate(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("humanCoaches", "write"),
    id = String(form.get(ID));
  await getBackOffice().record(
    administrator,
    (within) => getCoachingTaxes().validate(id, within),
    (result) => ({ section: "human_coaches", target: id, action: "tested", before: null, after: { fiscalSchemaValid: result } }),
  );
  await getCoachingTaxes().deliverCopies();
  redirect(PATH);
}
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { access } = await requireBackOffice("humanCoaches", "write"),
    t = await getServerT(),
    query = await searchParams,
    reports = await getCoachingTaxes().list();
  return (
    <BackOfficeLayout access={access} title={t("coachTax.adminTitle")}>
      <div className="section-page stack">
        <h1>{t("coachTax.adminTitle")}</h1>
        <p>{t("coachTax.preparedNotFiled")}</p>
        <p>{t("coachTax.basis")}</p>
        <p>{t("coachTax.supportedScope")}</p>
        {query.error ? <p role="alert">{t("coachTax.prepareError")}</p> : null}
        {!officialFiscalSchemaAvailable() ? <p role="status">{t("coachTax.schemaPending")}</p> : null}
        {taxLegalReady() ? (
          <form action={prepare} className="stack">
            <Field label={t("coachTax.year")}>
              <TextInput name={YEAR} type="number" min={2026} max={2026} defaultValue={2026} required />
            </Field>
            {FIELDS.map((field) => (
              <Field key={field} label={t(`coachTax.operator.${field}`)}>
                <TextInput name={field} required={field !== "vat"} maxLength={200} />
              </Field>
            ))}
            <button className="button" type="submit">
              {t("coachTax.prepare")}
            </button>
          </form>
        ) : (
          <p>{t("coachTax.legalPending")}</p>
        )}
        {reports.map((report) => (
          <ReportCard key={report.id} report={report} />
        ))}
      </div>
    </BackOfficeLayout>
  );
}
async function ReportCard({ report }: { report: { id: string; year: number; schemaValid: boolean; supersededAt: Date | null } }) {
  const t = await getServerT(),
    annual = await getCoachingTaxes().annual(report.id);
  if (!annual) return null;
  return (
    <article className="card stack">
      <h2>{t("coachTax.copyTitle", { year: report.year })}</h2>
      <p>{t(report.supersededAt ? "coachTax.superseded" : report.schemaValid ? "coachTax.schemaValid" : "coachTax.schemaPending")}</p>
      <a href={`/api/admin/coaching/tax/${report.id}?draft=1`}>{t("coachTax.downloadDraft")}</a>
      <a href={`/api/admin/coaching/tax/${report.id}?reconciliation=1`}>{t("coachTax.downloadReconciliation")}</a>
      {report.schemaValid && !report.supersededAt ? <a href={`/api/admin/coaching/tax/${report.id}`}>{t("coachTax.downloadXml")}</a> : null}
      {!report.supersededAt ? (
        <>
          <form action={validate}>
            <input type="hidden" name={ID} value={report.id} />
            <button className="button" type="submit">
              {t("coachTax.validateSchema")}
            </button>
          </form>
          <details>
            <summary>{t("coachTax.rebuild")}</summary>
            <p>{t("coachTax.rebuildExplanation")}</p>
            <form action={prepare} className="stack">
              <input type="hidden" name={YEAR} value={report.year} />
              <input type="hidden" name={REPLACE} value={report.id} />
              {FIELDS.map((field) => (
                <Field key={field} label={t(`coachTax.operator.${field}`)}>
                  <TextInput name={field} required={field !== "vat"} maxLength={200} defaultValue={annual.document.operator[field]} />
                </Field>
              ))}
              <Checkbox name={UNFILED} required label={t("coachTax.confirmUnfiled")} />
              <button className="button" type="submit">
                {t("coachTax.rebuild")}
              </button>
            </form>
          </details>
        </>
      ) : null}
    </article>
  );
}
