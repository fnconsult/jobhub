import { EUR_PER_USD } from "@jobhub/ai";
import type { Metadata } from "next";
import { requireBackOffice } from "@/admin/server";
import { COACH_MESSAGE_COST_TARGET_EUR } from "@/coach-conversations";
import { coachCostOfLastDays, playbookAgentCostOfLastDays } from "@/coach-conversations/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import "../section.css";

/** How many days back the page looks. */
const DAYS = 30;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("coachMessageCost");
  const t = await getServerT();
  return { title: `${t("admin.coachCost.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** Administrators follow what one AI Coach reply costs, per day: median and 90th percentile against the target. */
export default async function CoachCostPage() {
  const { access } = await requireBackOffice("coachMessageCost");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const [days, agents] = await Promise.all([coachCostOfLastDays(DAYS), playbookAgentCostOfLastDays(DAYS)]);
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
    <BackOfficeLayout access={access} title={t("admin.coachCost.title")}>
      <div className="section-page">
        <PageIntro t={t} page="coachCost" subject={t("admin.coachCost.title")} values={{ days: String(DAYS), target: eur.format(COACH_MESSAGE_COST_TARGET_EUR) }} />
        <p className="section-meta">{t("admin.coachCost.estimate", { rate: number.format(EUR_PER_USD) })}</p>
        {days.length === 0 ? (
          <p>{t("admin.coachCost.none")}</p>
        ) : (
          <Table
            label={t("admin.coachCost.caption")}
            columns={[
              { key: "day", header: t("admin.coachCost.day"), rowHeader: true, cell: (day) => <time dateTime={day.day}>{date.format(new Date(`${day.day}T00:00:00Z`))}</time> },
              { key: "messages", header: t("admin.coachCost.messages"), numeric: true, cell: (day) => number.format(day.messages) },
              { key: "median", header: t("admin.coachCost.median"), numeric: true, cell: (day) => cost(day.medianEur) },
              { key: "p90", header: t("admin.coachCost.p90"), numeric: true, cell: (day) => cost(day.p90Eur) },
              { key: "input", header: t("admin.coachCost.inputTokens"), numeric: true, cell: (day) => number.format(day.inputTokens) },
              { key: "cached", header: t("admin.coachCost.cachedInputTokens"), numeric: true, cell: (day) => number.format(day.cachedInputTokens) },
              { key: "output", header: t("admin.coachCost.outputTokens"), numeric: true, cell: (day) => number.format(day.outputTokens) },
              { key: "models", header: t("admin.coachCost.models"), cell: (day) => day.models.map((model) => `${model.provider} ${model.model} (${number.format(model.messages)})`).join(", ") },
              {
                key: "playbooks",
                header: t("admin.coachCost.playbooks"),
                cell: (day) => day.playbooks.map((playbook) => `${playbook.id} ${playbook.version} (${number.format(playbook.messages)})`).join(", "),
              },
            ]}
            rows={days}
            rowKey={(day) => day.day}
          />
        )}

        <section className="section-block" aria-labelledby="agents-title">
          <h2 id="agents-title">{t("admin.coachCost.agents.title")}</h2>
          <p>{t("admin.coachCost.agents.intro", { days: String(DAYS) })}</p>
          {agents.length === 0 ? (
            <p>{t("admin.coachCost.agents.none")}</p>
          ) : (
            <Table
              label={t("admin.coachCost.agents.caption")}
              columns={[
                { key: "playbook", header: t("admin.coachCost.agents.playbook"), rowHeader: true, cell: (agent) => agent.playbookId },
                { key: "consultations", header: t("admin.coachCost.agents.consultations"), numeric: true, cell: (agent) => number.format(agent.consultations) },
                { key: "median", header: t("admin.coachCost.agents.median"), numeric: true, cell: (agent) => eur.format(agent.medianEur) },
                {
                  key: "models",
                  header: t("admin.coachCost.agents.models"),
                  cell: (agent) => agent.models.map((model) => `${model.provider} ${model.model} (${number.format(model.consultations)})`).join(", "),
                },
              ]}
              rows={agents}
              rowKey={(agent) => agent.playbookId}
            />
          )}
        </section>
      </div>
    </BackOfficeLayout>
  );
}
