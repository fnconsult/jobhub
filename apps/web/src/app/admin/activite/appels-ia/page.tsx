import type { AiTask } from "@jobhub/ai";
import { AI_CALL_FAILURE_REASONS, OUTCOMES, type Outcome } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { MESSAGE_LOG_RETENTION_DAYS } from "@/ai-usage";
import { AI_TASKS, aiMessageLogFilter, LIST_LIMIT } from "@/ai-usage/message-log";
import { getAiMessageLogs } from "@/ai-usage/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { buttonClass } from "@/design/button-class";
import { Field, Select, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Status, type StatusTone } from "@/design/Pill";
import { Table } from "@/design/Table";
import { PageIntro } from "@/components/PageIntro";
import type { ActivityTabId } from "@/admin/activity";
import { ActivityTabs } from "../ActivityTabs";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../activite.css";

type Task = AiTask;

/** How a call ended, as its status dot says it beside its words (#465). */
const OUTCOME_TONE: Record<Outcome, StatusTone> = { ok: "success", warning: "warn", failed: "danger" };

/** This tab of Activité (#404). */
const TAB: ActivityTabId = "aiMessages";
/** The filter fields of a run's calls (#404), kept as the other filters change. */
const RUN_FIELDS = ["candidate", "from", "to"] as const;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("aiMessages");
  const t = await getServerT();
  return { title: `${t("admin.activity.tabs.aiMessages")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Activité › Appels IA (formerly Journaux IA, #404): super-admins find an AI Message Log (#218): newest first, filtered by task, model, Candidate
 * email, day, Outcome and Failure Reason (#259), a warning's code too (#260). The list shows no text, only how each
 * call ended and why; opening a log writes the view to the Back Office Audit.
 */
export default async function AiMessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { access } = await requireBackOffice("aiMessages");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const filter = aiMessageLogFilter(await searchParams);
  const logs = await getAiMessageLogs().list(filter);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });

  return (
    <BackOfficeLayout access={access} title={t("admin.activity.title")}>
      <div className="activite">
        <ActivityTabs access={access} shown={TAB} />
        <PageIntro t={t} page={TAB} subject={t("admin.activity.tabs.aiMessages")} values={{ days: String(MESSAGE_LOG_RETENTION_DAYS) }} />

        {filter.candidate ? (
          <Note role="status">
            <p>{t("admin.aiMessages.ofRun")}</p>
          </Note>
        ) : null}
        <form method="get" action={routes.adminAiMessages()} className="activity-filter" aria-label={t("admin.aiMessages.filter")}>
          {/* A run's calls (#404): its Candidate and time window stay while the other filters change. */}
          {RUN_FIELDS.map((name) => (filter[name] ? <input key={name} type="hidden" name={name} value={filter[name]} /> : null))}
          <Field label={t("admin.aiMessages.task")}>
            <Select name="task" defaultValue={filter.task ?? ""}>
              <option value="">{t("admin.aiMessages.anyTask")}</option>
              {AI_TASKS.map((task) => (
                <option key={task} value={task}>
                  {t(`admin.aiUsage.tasks.${task as Task}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.aiMessages.model")}>
            <TextInput name="model" defaultValue={filter.model ?? ""} />
          </Field>
          <Field label={t("admin.aiMessages.email")}>
            <TextInput name="email" type="email" defaultValue={filter.email ?? ""} />
          </Field>
          <Field label={t("admin.aiMessages.day")}>
            <TextInput name="day" type="date" defaultValue={filter.day ?? ""} />
          </Field>
          <Field label={t("admin.aiMessages.result")}>
            <Select name="outcome" defaultValue={filter.outcome ?? ""}>
              <option value="">{t("admin.aiMessages.anyOutcome")}</option>
              {OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {t(`admin.aiMessages.outcomes.${outcome}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.aiMessages.reason")}>
            <Select name="reason" defaultValue={filter.reason ?? ""}>
              <option value="">{t("admin.aiMessages.anyReason")}</option>
              {AI_CALL_FAILURE_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {t(`failureReasons.${reason}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="activity-filter-actions">
            <button type="submit" className={buttonClass()}>
              {t("admin.aiMessages.apply")}
            </button>{" "}
            <Link href={routes.adminAiMessages()}>{t("admin.aiMessages.reset")}</Link>
          </div>
        </form>

        {logs.length === 0 ? (
          <p>{t("admin.aiMessages.none")}</p>
        ) : (
          <>
            {logs.length >= LIST_LIMIT ? <p>{t("admin.aiMessages.limit", { count: String(LIST_LIMIT) })}</p> : null}
            <Table
              label={t("admin.aiMessages.caption")}
              columns={[
                { header: t("admin.aiMessages.at"), rowHeader: true, cell: (log) => <time dateTime={log.at.toISOString()}>{at.format(log.at)}</time> },
                { header: t("admin.aiMessages.task"), cell: (log) => (AI_TASKS.includes(log.task) ? t(`admin.aiUsage.tasks.${log.task as Task}`) : log.task) },
                { header: t("admin.aiMessages.provider"), cell: (log) => (log.provider ? `${log.provider} ${log.model ?? ""}` : t("admin.aiMessages.noProvider")) },
                { header: t("admin.aiMessages.candidate"), cell: (log) => log.candidate?.email ?? t("admin.aiMessages.noCandidate") },
                {
                  header: t("admin.aiMessages.result"),
                  cell: (log) => (
                    <>
                      <Status tone={OUTCOME_TONE[log.outcome]}>{t(`admin.aiMessages.outcomes.${log.outcome}`)}</Status>
                      {[log.reason, ...log.warnings.filter((warning) => warning !== log.reason)].flatMap((reason) => (reason ? [` · ${t(`failureReasons.${reason}`)}`] : []))}
                      {log.sent ? null : ` · ${t("admin.aiMessages.notSent")}`}
                    </>
                  ),
                },
                {
                  header: <span className="visually-hidden">{t("admin.aiMessages.open")}</span>,
                  cell: (log) => (
                    <Link href={routes.adminAiMessage(log.id)} prefetch={false} aria-label={t("admin.aiMessages.openLabel", { at: at.format(log.at) })}>
                      {t("admin.aiMessages.open")}
                    </Link>
                  ),
                },
              ]}
              rows={logs}
              rowKey={(log) => log.id}
            />
          </>
        )}
      </div>
    </BackOfficeLayout>
  );
}
