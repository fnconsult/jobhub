import type { AiTask } from "@jobhub/ai";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { AI_TASKS } from "@/ai-usage/message-log";
import { getAiMessageLogs } from "@/ai-usage/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type Task = AiTask;
type Params = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  // Not the log itself: reading it here would write a second view to the Back Office Audit.
  await requireBackOffice("aiMessages");
  const t = await getServerT();
  return { title: `${t("admin.aiMessages.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * A super-admin reads one AI Message Log (#218); the view is written to the Back Office Audit as it is read.
 * A call that failed or warned says why (#259): its Failure Reason's wording, then its technical reason.
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
      <p>
        <Link href={routes.adminAiMessages()}>{t("admin.aiMessages.back")}</Link>
      </p>
      <p className="notice" role="status">
        {t("admin.aiMessages.audited")}
      </p>

      <h2>{t("admin.aiMessages.details")}</h2>
      <dl className="props" aria-label={t("admin.aiMessages.details")}>
        <dt>{t("admin.aiMessages.task")}</dt>
        <dd>{AI_TASKS.includes(log.task) ? t(`admin.aiUsage.tasks.${log.task as Task}`) : log.task}</dd>
        <dt>{t("admin.aiMessages.provider")}</dt>
        <dd>{log.provider ? `${log.provider} ${log.model ?? ""}` : t("admin.aiMessages.noProvider")}</dd>
        <dt>{t("admin.aiMessages.candidate")}</dt>
        <dd>{log.candidate?.email ?? t("admin.aiMessages.noCandidate")}</dd>
        <dt>{t("admin.aiMessages.result")}</dt>
        <dd>
          {t(`admin.aiMessages.outcomes.${log.outcome}`)}
          {log.sent ? null : ` · ${t("admin.aiMessages.notSent")}`}
        </dd>
        <dt>{t("admin.aiMessages.tokens")}</dt>
        <dd>
          {number.format(log.inputTokens)}, {number.format(log.cachedInputTokens)}, {number.format(log.outputTokens)}
        </dd>
        <dt>{t("admin.aiMessages.cost")}</dt>
        <dd>{eur.format(log.costEur)}</dd>
        <dt>{t("admin.aiMessages.duration")}</dt>
        <dd>{milliseconds.format(log.durationMs)}</dd>
      </dl>

      {log.outcome === "ok" ? null : (
        <section aria-labelledby="ai-message-why">
          <h2 id="ai-message-why">{t("admin.aiMessages.why")}</h2>
          <p>{log.reason ? t(`failureReasons.${log.reason}`) : t("admin.aiMessages.reasonUnknown")}</p>
          <h3>{t("admin.aiMessages.technical")}</h3>
          {log.technicalReason ? (
            <dl className="props" aria-label={t("admin.aiMessages.technical")}>
              <dt>{t("admin.aiMessages.technicalFields.class")}</dt>
              <dd>{log.technicalReason.class}</dd>
              {log.technicalReason.provider ? (
                <>
                  <dt>{t("admin.aiMessages.technicalFields.provider")}</dt>
                  <dd>{log.technicalReason.provider}</dd>
                </>
              ) : null}
              {log.technicalReason.status === undefined ? null : (
                <>
                  <dt>{t("admin.aiMessages.technicalFields.status")}</dt>
                  <dd>{log.technicalReason.status}</dd>
                </>
              )}
              <dt>{t("admin.aiMessages.technicalFields.message")}</dt>
              <dd className="ai-message-text">{log.technicalReason.message}</dd>
            </dl>
          ) : (
            <p>{t("admin.aiMessages.noTechnical")}</p>
          )}
        </section>
      )}

      {log.system ? (
        <>
          <h2>{t("admin.aiMessages.system")}</h2>
          <div className="draft ai-message-text">{log.system}</div>
        </>
      ) : null}

      <h2>{t("admin.aiMessages.messages")}</h2>
      <ol className="stack">
        {log.messages.map((message, index) => (
          <li key={index}>
            <h3>{message.role === "assistant" ? t("admin.aiMessages.roles.assistant") : t("admin.aiMessages.roles.user")}</h3>
            <div className="draft ai-message-text">{message.content}</div>
          </li>
        ))}
      </ol>

      <h2>{t("admin.aiMessages.reply")}</h2>
      {log.reply === null ? <p>{log.sent ? t("admin.aiMessages.noReply") : t("admin.aiMessages.noReplyNotSent")}</p> : <div className="draft ai-message-text">{log.reply}</div>}
    </BackOfficeLayout>
  );
}
