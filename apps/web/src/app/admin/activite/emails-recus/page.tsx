import { Field, Select } from "@/design/Field";
import { Pill } from "@/design/Pill";
import { Table } from "@/design/Table";
import type { Metadata } from "next";
import type { ActivityTabId } from "@/admin/activity";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { buttonClass } from "@/design/button-class";
import { PageIntro } from "@/components/PageIntro";
import { ACTIVITY_RETENTION_MONTHS, LIST_LIMIT, RECEIVED_EMAIL_KINDS, RECEIVED_EMAIL_OUTCOMES, RECEIVED_EMAIL_PERIODS, receivedEmailsFilter } from "@/email-intake/activity";
import { getEmailIntakeActivity } from "@/email-intake/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { ActivityTabs } from "../ActivityTabs";
import "../activite.css";

type Search = Record<string, string | string[] | undefined>;

/** This tab of Activité (#449). */
const TAB: ActivityTabId = "receivedEmails";
/** The table's hook for the tests. */
const TEST_ID = "received-emails";

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
      <div className="activite">
        <ActivityTabs access={access} shown={TAB} />
        <PageIntro t={t} page={TAB} subject={t("admin.activity.tabs.receivedEmails")} values={{ months: String(ACTIVITY_RETENTION_MONTHS) }} />

        <form method="get" action={routes.adminReceivedEmails()} className="activity-filter" aria-label={t("admin.receivedEmails.filter")}>
          <Field label={t("admin.receivedEmails.outcome")}>
            <Select name="resultat" defaultValue={filter.outcome ?? ""}>
              <option value="">{t("admin.receivedEmails.anyOutcome")}</option>
              {RECEIVED_EMAIL_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {t(`admin.receivedEmails.outcomes.${outcome}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.receivedEmails.kind")}>
            <Select name="type" defaultValue={filter.kind ?? ""}>
              <option value="">{t("admin.receivedEmails.anyKind")}</option>
              {RECEIVED_EMAIL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`admin.receivedEmails.kinds.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.receivedEmails.period")}>
            <Select name="periode" defaultValue={filter.period}>
              {RECEIVED_EMAIL_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {t(`admin.receivedEmails.periods.${period}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="activity-filter-actions">
            <button type="submit" className={buttonClass()}>
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
            <Table
              label={t("admin.receivedEmails.caption")}
              data-testid={TEST_ID}
              columns={[
                { header: t("admin.receivedEmails.at"), rowHeader: true, cell: (row) => <time dateTime={row.receivedAt.toISOString()}>{at.format(row.receivedAt)}</time> },
                {
                  header: t("admin.receivedEmails.sender"),
                  cell: (row) => (
                    <>
                      <code>{row.senderDomain}</code>
                      {row.manualForward ? <div className="activity-meta">{t("admin.receivedEmails.manualForward")}</div> : null}
                    </>
                  ),
                },
                {
                  header: t("admin.receivedEmails.kind"),
                  cell: (row) => (row.kind ? t(`admin.receivedEmails.kinds.${row.kind}`) : <span className="activity-meta">{t("admin.receivedEmails.notRead")}</span>),
                },
                {
                  header: t("admin.receivedEmails.offers"),
                  cell: (row) => (row.offers ? t("admin.receivedEmails.offersValue", { new: row.offers.new, alreadyStored: row.offers.alreadyStored }) : <span className="activity-meta">—</span>),
                },
                { header: t("admin.receivedEmails.outcome"), cell: (row) => t(`admin.receivedEmails.outcomes.${row.outcome}`) },
                {
                  header: t("admin.receivedEmails.guardrail"),
                  cell: (row) =>
                    row.guardrail ? (
                      <Pill tone={row.guardrail === "blocked" ? "danger" : row.guardrail === "flagged" ? "accent" : "success"}>{t(`admin.receivedEmails.guardrails.${row.guardrail}`)}</Pill>
                    ) : (
                      <span className="activity-meta">—</span>
                    ),
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              rowAttributes={(row) => ({ "data-received-email": row.id })}
            />
          </>
        )}
        <p className="activity-meta">{t("admin.receivedEmails.noCandidate")}</p>
      </div>
    </BackOfficeLayout>
  );
}
