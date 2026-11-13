import { REPORT_OUTCOMES } from "./values";
import { redirect } from "next/navigation";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { getServerT } from "@/i18n/server";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Select, Textarea } from "@/design/Field";
import { Status } from "@/design/Pill";
import { getContentReports } from "./server";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
const DEFAULT_OUTCOME = "keep";
const ID = "id",
  REVISION = "revision",
  OUTCOME = "outcome",
  REASON = "reason",
  DESTINATION = "/admin/signalements";
async function decide(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("signalements", "write"),
    id = String(form.get(ID));
  const result = await getBackOffice().record(
    administrator,
    (within) => getContentReports().decide(id, { outcome: form.get(OUTCOME), reason: form.get(REASON), expectedRevision: Number(form.get(REVISION)) }, within),
    (change) =>
      change
        ? {
            section: "signalements",
            target: id,
            action: "updated",
            before: change.before,
            after: { outcome: change.after.outcome, revision: change.after.revision, reason: "provided" },
          }
        : null,
  );
  if (result) await getContentReports().deliverNotices(id);
  redirect(result ? DESTINATION : `${DESTINATION}?contentReport=invalid`);
}
export async function ContentReportsAdmin({ canWrite }: { canWrite: boolean }) {
  if (!canWrite) return null;
  const [rows, t] = await Promise.all([getContentReports().list(), getServerT()]);
  return (
    <section className="section-block stack">
      <h2>{t("contentReport.admin.title")}</h2>
      <p>{t("contentReport.admin.intro")}</p>
      {!rows.length ? (
        <p>{t("contentReport.admin.none")}</p>
      ) : (
        rows.map((row) => (
          <Card as={ARTICLE} headingLevel={3} title={t(row.target === "page" ? "contentReport.pageTarget" : "contentReport.offerTarget", { name: row.coachName })} key={row.id}>
            <div className="stack">
              <p>{t("contentReport.reference", { id: row.id })}</p>
              {row.explanation ? (
                <>
                  <p>{t(`contentReport.reasons.${row.reason ?? "other"}`)}</p>
                  <p className="pre-wrap">{row.explanation}</p>
                  <p>
                    {row.reporterName} {row.reporterEmail}
                  </p>
                </>
              ) : (
                <p>{t("contentReport.admin.erased")}</p>
              )}
              <p>
                <Status tone={row.outcome ? "neutral" : "warn"}>{row.outcome ? t(`contentReport.outcomes.${row.outcome}`) : t("contentReport.admin.pending")}</Status>
              </p>
              {row.decisionReason ? <p className="pre-wrap">{row.decisionReason}</p> : null}
              <form action={decide} className="stack">
                <input type="hidden" name={ID} value={row.id} />
                <input type="hidden" name={REVISION} value={row.revision} />
                <Field label={t("contentReport.admin.outcome")}>
                  <Select name={OUTCOME} defaultValue={row.outcome ?? DEFAULT_OUTCOME}>
                    {REPORT_OUTCOMES.map((value) => (
                      <option key={value} value={value}>
                        {t(`contentReport.outcomes.${value}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("contentReport.admin.reason")}>
                  <Textarea name={REASON} required minLength={3} maxLength={2000} />
                </Field>
                <button className={buttonClass({ size: "sm" })} type="submit">
                  {t("contentReport.admin.decide")}
                </button>
              </form>
            </div>
          </Card>
        ))
      )}
    </section>
  );
}
