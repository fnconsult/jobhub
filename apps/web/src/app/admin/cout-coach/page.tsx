import { EUR_PER_USD } from "@jobhub/ai";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdministrator } from "@/admin/server";
import { COACH_MESSAGE_COST_TARGET_EUR } from "@/coach-conversations";
import { coachCostOfLastDays } from "@/coach-conversations/server";
import { BackOfficeHeader } from "@/components/BackOfficeHeader";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** How many days back the page looks. */
const DAYS = 30;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireAdministrator();
  const t = await getServerT();
  return { title: `${t("admin.coachCost.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** Administrators follow what one AI Coach reply costs, per day: median and 90th percentile against the target. */
export default async function CoachCostPage() {
  await requireAdministrator();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const days = await coachCostOfLastDays(DAYS);
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const cost = (value: number) =>
    value > COACH_MESSAGE_COST_TARGET_EUR ? (
      <strong>
        {eur.format(value)} ({t("admin.coachCost.overTarget")})
      </strong>
    ) : (
      eur.format(value)
    );

  return (
    <main className="page">
      <BackOfficeHeader />
      <p>
        <Link href={routes.admin}>{t("admin.back")}</Link>
      </p>
      <h1>{t("admin.coachCost.title")}</h1>
      <p className="lead">{t("admin.coachCost.intro", { days: String(DAYS), target: eur.format(COACH_MESSAGE_COST_TARGET_EUR) })}</p>
      <p>{t("admin.coachCost.estimate", { rate: number.format(EUR_PER_USD) })}</p>
      {days.length === 0 ? (
        <p>{t("admin.coachCost.none")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.coachCost.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.coachCost.day")}</th>
                <th scope="col">{t("admin.coachCost.messages")}</th>
                <th scope="col">{t("admin.coachCost.median")}</th>
                <th scope="col">{t("admin.coachCost.p90")}</th>
                <th scope="col">{t("admin.coachCost.inputTokens")}</th>
                <th scope="col">{t("admin.coachCost.cachedInputTokens")}</th>
                <th scope="col">{t("admin.coachCost.outputTokens")}</th>
                <th scope="col">{t("admin.coachCost.models")}</th>
                <th scope="col">{t("admin.coachCost.playbooks")}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day}>
                  <th scope="row">
                    <time dateTime={day.day}>{date.format(new Date(`${day.day}T00:00:00Z`))}</time>
                  </th>
                  <td>{number.format(day.messages)}</td>
                  <td>{cost(day.medianEur)}</td>
                  <td>{cost(day.p90Eur)}</td>
                  <td>{number.format(day.inputTokens)}</td>
                  <td>{number.format(day.cachedInputTokens)}</td>
                  <td>{number.format(day.outputTokens)}</td>
                  <td>{day.models.map((model) => `${model.provider} ${model.model} (${number.format(model.messages)})`).join(", ")}</td>
                  <td>{day.playbooks.map((playbook) => `${playbook.id} ${playbook.version} (${number.format(playbook.messages)})`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
