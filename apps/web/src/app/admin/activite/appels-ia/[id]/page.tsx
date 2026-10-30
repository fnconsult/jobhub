import type { AiTask } from "@jobhub/ai";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { AI_TASKS } from "@/ai-usage/message-log";
import { getAiMessageLogs } from "@/ai-usage/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../../../section.css";

type Task = AiTask;
type Params = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  // Not the log itself: reading it here would write a second view to the Back Office Audit.
  await requireBackOffice("aiMessages");
  const t = await getServerT();
  return { title: `${t("admin.aiMessages.title")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * A super-admin reads one AI Message Log (#218); the view is written to the Back Office Audit as it is read.
 * A call that failed or warned says why (#259): its Failure Reason's wording, then its feature's warnings, each with what
 * happened (#260), then its technical reason.
 */
export default async function AiMessagePage({ params }: Params) {
  const { access, administrator } = await requireBackOffice("aiMessages");
  const log = await getAiMessageLogs().open(administrator, (await params).id);
  if (!log) notFound();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });
  const number = new Intl.NumberFormat(locale);
  const milliseconds = new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond" });
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 6 });

  return (
    <BackOfficeLayout
      access={access}
      title={
        <h1>
          {t("admin.aiMessages.title")} · <time dateTime={log.at.toISOString()}>{at.format(log.at)}</time>
        </h1>
      }
    >
      <div className="section-page">
        <p>
          <Link href={routes.adminAiMessages()}>{t("admin.aiMessages.back")}</Link>
        </p>
        <Note role="status">{t("admin.aiMessages.audited")}</Note>

        <Card title={t("admin.aiMessages.details")}>
          <Properties label={t("admin.aiMessages.details")}>
            <Property term={t("admin.aiMessages.task")}>{AI_TASKS.includes(log.task) ? t(`admin.aiUsage.tasks.${log.task as Task}`) : log.task}</Property>
            <Property term={t("admin.aiMessages.provider")}>{log.provider ? `${log.provider} ${log.model ?? ""}` : t("admin.aiMessages.noProvider")}</Property>
            <Property term={t("admin.aiMessages.candidate")}>{log.candidate?.email ?? t("admin.aiMessages.noCandidate")}</Property>
            <Property term={t("admin.aiMessages.result")}>
              {t(`admin.aiMessages.outcomes.${log.outcome}`)}
              {log.sent ? null : ` · ${t("admin.aiMessages.notSent")}`}
            </Property>
            <Property term={t("admin.aiMessages.tokens")}>
              {number.format(log.inputTokens)}, {number.format(log.cachedInputTokens)}, {number.format(log.outputTokens)}
            </Property>
            <Property term={t("admin.aiMessages.cost")}>{eur.format(log.costEur)}</Property>
            <Property term={t("admin.aiMessages.duration")}>{milliseconds.format(log.durationMs)}</Property>
          </Properties>
        </Card>

        {log.outcome === "ok" ? null : (
          <section aria-labelledby="ai-message-why">
            <Card title={<span id="ai-message-why">{t("admin.aiMessages.why")}</span>}>
              <div className="section-block">
                {log.outcome === "warning" && log.warningDetails.length > 0 ? null : <p>{log.reason ? t(`failureReasons.${log.reason}`) : t("admin.aiMessages.reasonUnknown")}</p>}
                {log.warningDetails.length > 0 ? (
                  <>
                    {log.outcome === "warning" ? null : <h3>{t("admin.aiMessages.warnings")}</h3>}
                    <ul aria-label={t("admin.aiMessages.warnings")}>
                      {log.warningDetails.map((warning, index) => (
                        <li key={index}>
                          {t(`failureReasons.${warning.reason}`)}
                          {warning.detail ? (
                            <>
                              {" · "}
                              <span className="section-text">{warning.detail}</span>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {log.outcome === "warning" && !log.technicalReason ? null : <h3>{t("admin.aiMessages.technical")}</h3>}
                {log.outcome === "warning" && !log.technicalReason ? null : log.technicalReason ? (
                  <Properties label={t("admin.aiMessages.technical")}>
                    <Property term={t("admin.aiMessages.technicalFields.class")}>{log.technicalReason.class}</Property>
                    {log.technicalReason.provider ? <Property term={t("admin.aiMessages.technicalFields.provider")}>{log.technicalReason.provider}</Property> : null}
                    {log.technicalReason.status === undefined ? null : <Property term={t("admin.aiMessages.technicalFields.status")}>{log.technicalReason.status}</Property>}
                    <Property term={t("admin.aiMessages.technicalFields.message")}>
                      <span className="section-text">{log.technicalReason.message}</span>
                    </Property>
                  </Properties>
                ) : (
                  <p>{t("admin.aiMessages.noTechnical")}</p>
                )}
              </div>
            </Card>
          </section>
        )}

        {log.system ? (
          <section className="section-block" aria-labelledby="ai-message-system">
            <h2 id="ai-message-system">{t("admin.aiMessages.system")}</h2>
            <div className="section-text" data-boxed>
              {log.system}
            </div>
          </section>
        ) : null}

        <section className="section-block" aria-labelledby="ai-message-messages">
          <h2 id="ai-message-messages">{t("admin.aiMessages.messages")}</h2>
          <ol className="section-list">
            {log.messages.map((message, index) => (
              <li key={index} className="section-block">
                <h3>{message.role === "assistant" ? t("admin.aiMessages.roles.assistant") : t("admin.aiMessages.roles.user")}</h3>
                <div className="section-text" data-boxed>
                  {message.content}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="section-block" aria-labelledby="ai-message-reply">
          <h2 id="ai-message-reply">{t("admin.aiMessages.reply")}</h2>
          {log.reply === null ? (
            <p>{log.sent ? t("admin.aiMessages.noReply") : t("admin.aiMessages.noReplyNotSent")}</p>
          ) : (
            <div className="section-text" data-boxed>
              {log.reply}
            </div>
          )}
        </section>
      </div>
    </BackOfficeLayout>
  );
}
