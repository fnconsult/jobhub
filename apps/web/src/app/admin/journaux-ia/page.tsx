import type { AiTask } from "@jobhub/ai";
import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { MESSAGE_LOG_RETENTION_DAYS } from "@/ai-usage";
import { AI_TASKS, aiMessageLogFilter, LIST_LIMIT } from "@/ai-usage/message-log";
import { getAiMessageLogs } from "@/ai-usage/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type Task = AiTask;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("aiMessages");
  const t = await getServerT();
  return { title: `${t("admin.aiMessages.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Super-admins find an AI Message Log (#218): newest first, filtered by task, model, Candidate
 * email and day. The list shows no text; opening a log writes the view to the Back Office Audit.
 */
export default async function AiMessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { access } = await requireBackOffice("aiMessages");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const filter = aiMessageLogFilter(await searchParams);
  const logs = await getAiMessageLogs().list(filter);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" });

  return (
    <BackOfficeLayout access={access}>
      <h1>{t("admin.aiMessages.title")}</h1>
      <p className="lead">{t("admin.aiMessages.intro", { days: String(MESSAGE_LOG_RETENTION_DAYS) })}</p>

      <form method="get" action={routes.adminAiMessages()} className="stack" aria-label={t("admin.aiMessages.filter")}>
        <div className="field">
          <label htmlFor="ai-messages-task">{t("admin.aiMessages.task")}</label>
          <select id="ai-messages-task" name="task" className="input" defaultValue={filter.task ?? ""}>
            <option value="">{t("admin.aiMessages.anyTask")}</option>
            {AI_TASKS.map((task) => (
              <option key={task} value={task}>
                {t(`admin.aiUsage.tasks.${task as Task}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ai-messages-model">{t("admin.aiMessages.model")}</label>
          <input id="ai-messages-model" name="model" className="input" defaultValue={filter.model ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="ai-messages-email">{t("admin.aiMessages.email")}</label>
          <input id="ai-messages-email" name="email" type="email" className="input" defaultValue={filter.email ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="ai-messages-day">{t("admin.aiMessages.day")}</label>
          <input id="ai-messages-day" name="day" type="date" className="input" defaultValue={filter.day ?? ""} />
        </div>
        <div>
          <button type="submit" className="button">
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
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.aiMessages.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.aiMessages.at")}</th>
                  <th scope="col">{t("admin.aiMessages.task")}</th>
                  <th scope="col">{t("admin.aiMessages.provider")}</th>
                  <th scope="col">{t("admin.aiMessages.candidate")}</th>
                  <th scope="col">{t("admin.aiMessages.result")}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t("admin.aiMessages.open")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <th scope="row">
                      <time dateTime={log.at.toISOString()}>{at.format(log.at)}</time>
                    </th>
                    <td>{AI_TASKS.includes(log.task) ? t(`admin.aiUsage.tasks.${log.task as Task}`) : log.task}</td>
                    <td>
                      {log.provider} {log.model}
                    </td>
                    <td>{log.candidate?.email ?? t("admin.aiMessages.noCandidate")}</td>
                    <td>{log.ok ? t("admin.aiMessages.ok") : t("admin.aiMessages.failed")}</td>
                    <td>
                      <Link href={routes.adminAiMessage(log.id)} prefetch={false} aria-label={t("admin.aiMessages.openLabel", { at: at.format(log.at) })}>
                        {t("admin.aiMessages.open")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </BackOfficeLayout>
  );
}
