import type { Metadata } from "next";
import type { ActivityTabId } from "@/admin/activity";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { ACTIVITY_RETENTION_MONTHS, LIST_LIMIT, RECEIVED_EMAIL_KINDS, RECEIVED_EMAIL_OUTCOMES, RECEIVED_EMAIL_PERIODS, receivedEmailsFilter } from "@/email-intake/activity";
import { getEmailIntakeActivity } from "@/email-intake/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { ActivityTabs } from "../ActivityTabs";

type Search = Record<string, string | string[] | undefined>;

/** This tab of Activité (#449). */
const TAB: ActivityTabId = "receivedEmails";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("receivedEmails");
  const t = await getServerT();
  return { title: `${t("admin.activity.tabs.receivedEmails")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Activité › Emails reçus (#449, ADR-0051): every Received offer email of Email intake, newest first, filtered by
 * outcome, kind and period: when, the sender's domain, its kind, the offers new and already stored, its outcome and
 * its Guardrail verdict. No Candidate is named and nothing of the email's content is shown; super-admins, Technique
 * and Support read it.
 */
export default async function ReceivedEmailsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { access } = await requireBackOffice("receivedEmails");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const search = await searchParams;
  const filter = receivedEmailsFilter({ outcome: search.resultat, kind: search.type, period: search.periode });
  const rows = await getEmailIntakeActivity().receivedEmails(filter);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <BackOfficeLayout access={access} title={t("admin.activity.title")}>
      <ActivityTabs access={access} shown={TAB} />
      <p className="lead">{t("admin.receivedEmails.intro", { months: String(ACTIVITY_RETENTION_MONTHS) })}</p>

      <form method="get" action={routes.adminReceivedEmails()} className="activity-filter" aria-label={t("admin.receivedEmails.filter")}>
        <div className="field">
          <label htmlFor="received-outcome">{t("admin.receivedEmails.outcome")}</label>
          <select id="received-outcome" name="resultat" className="input" defaultValue={filter.outcome ?? ""}>
            <option value="">{t("admin.receivedEmails.anyOutcome")}</option>
            {RECEIVED_EMAIL_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {t(`admin.receivedEmails.outcomes.${outcome}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="received-kind">{t("admin.receivedEmails.kind")}</label>
          <select id="received-kind" name="type" className="input" defaultValue={filter.kind ?? ""}>
            <option value="">{t("admin.receivedEmails.anyKind")}</option>
            {RECEIVED_EMAIL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`admin.receivedEmails.kinds.${kind}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="received-period">{t("admin.receivedEmails.period")}</label>
          <select id="received-period" name="periode" className="input" defaultValue={filter.period}>
            {RECEIVED_EMAIL_PERIODS.map((period) => (
              <option key={period} value={period}>
                {t(`admin.receivedEmails.periods.${period}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button type="submit" className="button">
            {t("admin.receivedEmails.apply")}
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <p>{t("admin.receivedEmails.none")}</p>
      ) : (
        <>
          <p>{t("admin.receivedEmails.count", { count: rows.length })}</p>
          {rows.length >= LIST_LIMIT ? <p>{t("admin.receivedEmails.limit", { count: String(LIST_LIMIT) })}</p> : null}
          <div className="table-scroll">
            <table className="application-table" data-testid="received-emails">
              <caption>{t("admin.receivedEmails.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.receivedEmails.at")}</th>
                  <th scope="col">{t("admin.receivedEmails.sender")}</th>
                  <th scope="col">{t("admin.receivedEmails.kind")}</th>
                  <th scope="col">{t("admin.receivedEmails.offers")}</th>
                  <th scope="col">{t("admin.receivedEmails.outcome")}</th>
                  <th scope="col">{t("admin.receivedEmails.guardrail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-received-email={row.id}>
                    <th scope="row">
                      <time dateTime={row.receivedAt.toISOString()}>{at.format(row.receivedAt)}</time>
                    </th>
                    <td>
                      <code>{row.senderDomain}</code>
                      {row.manualForward ? <div className="activity-meta">{t("admin.receivedEmails.manualForward")}</div> : null}
                    </td>
                    <td>{row.kind ? t(`admin.receivedEmails.kinds.${row.kind}`) : <span className="activity-meta">{t("admin.receivedEmails.notRead")}</span>}</td>
                    <td>{row.offers ? t("admin.receivedEmails.offersValue", { new: row.offers.new, alreadyStored: row.offers.alreadyStored }) : <span className="activity-meta">—</span>}</td>
                    <td>{t(`admin.receivedEmails.outcomes.${row.outcome}`)}</td>
                    <td>
                      {row.guardrail ? (
                        <span className="pill" data-tone={row.guardrail === "blocked" ? "danger" : row.guardrail === "flagged" ? "accent" : "success"}>
                          {t(`admin.receivedEmails.guardrails.${row.guardrail}`)}
                        </span>
                      ) : (
                        <span className="activity-meta">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="activity-meta">{t("admin.receivedEmails.noCandidate")}</p>
    </BackOfficeLayout>
  );
}
