import type { Locale } from "@jobhub/shared/i18n";
import Link from "next/link";
import type { ApiBlockRow } from "@/back-office-dashboard/api-block";
import { ExplainableLabel, type ExplainedContext } from "@/components/ExplainableLabel";
import { ExternalLink } from "@/components/ExternalLink";
import { Stat, Stats } from "@/design/Card";
import { Status, type StatusTone } from "@/design/Pill";
import { getServerT } from "@/i18n/server";
import { TableView } from "./dashboard-charts";

/** A Tool's state, as an Explainable label tells the Back Office Assistant about it (#407): a Dashboard figure. */
const FIGURE: Pick<ExplainedContext, "kind"> = { kind: "figure" };
/** A state's tone: « OK » success, « limite atteinte » warn (it passes), « quota épuisé » danger (it lasts until paid). */
const TONE: Record<ApiBlockRow["state"], StatusTone> = { ok: "success", rate_limited: "warn", quota_exhausted: "danger" };

/**
 * The Dashboard's « API » block (#1116): each configured Tool with a quota, its state (« OK », « limite atteinte »,
 * « quota épuisé »), since when and its renewal date when its provider gave one, with the « Quota atteint » banner's
 * links: where it is configured, its provider's billing page in a new tab (through the Exit Page). Every Administrator sees it, « OK » included.
 * Each Tool's name is an Explainable label (#407); its table view holds every row.
 */
export async function ApiBlock({ rows, locale }: { rows: readonly ApiBlockRow[]; locale: Locale }) {
  const t = await getServerT(locale);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const time = (date: Date) => <time dateTime={date.toISOString()}>{dateTime.format(date)}</time>;
  const stateOf = (row: ApiBlockRow) => t(`admin.dashboard.api.states.${row.state}`);
  /** What a row says of its state beside it: since when and its renewal, or that its provider accepts its calls. */
  const metaOf = (row: ApiBlockRow) =>
    row.state === "ok"
      ? t("admin.dashboard.api.okSub")
      : [row.since ? t("admin.dashboard.api.since", { date: dateTime.format(row.since) }) : null, row.renewsAt ? t("admin.dashboard.api.renewsAt", { date: dateTime.format(row.renewsAt) }) : null]
          .filter(Boolean)
          .join(" · ");
  const links = (row: ApiBlockRow) => (
    <span className="dashboard-api-links">
      {row.configHref ? (
        <Link prefetch={false} href={row.configHref} aria-label={t("admin.dashboard.api.configLabel", { tool: row.toolName })}>
          {t("admin.dashboard.api.config")}
        </Link>
      ) : null}
      <ExternalLink href={row.billingUrl} aria-label={t("admin.dashboard.api.billingLabel", { tool: row.toolName })}>
        {t("admin.dashboard.api.billing")}
      </ExternalLink>
    </span>
  );

  return (
    <section className="dashboard-block dashboard-api stack" aria-labelledby="dashboard-api">
      <h2 id="dashboard-api">
        {t("admin.dashboard.api.title")} <span className="dashboard-period">· {t("admin.dashboard.api.period")}</span>
      </h2>

      {rows.length === 0 ? (
        <p>{t("admin.dashboard.api.noTools")}</p>
      ) : (
        <>
          <Stats label={t("admin.dashboard.api.tableTitle")}>
            {rows.map((row) => (
              <Stat
                key={row.toolId}
                label={
                  <ExplainableLabel item={{ ...FIGURE, id: `tool_quota_state.${row.toolId}`, value: stateOf(row), state: metaOf(row) }}>{row.toolName}</ExplainableLabel>
                }
                name={row.toolName}
                value={<Status tone={TONE[row.state]}>{stateOf(row)}</Status>}
                meta={metaOf(row)}
                note={links(row)}
              />
            ))}
          </Stats>
          <TableView
            t={t}
            caption={t("admin.dashboard.api.tableTitle")}
            columns={[
              { header: t("admin.dashboard.api.tool"), rowHeader: true, cell: (row) => row.toolName },
              { header: t("admin.dashboard.api.state"), cell: stateOf },
              { header: t("admin.dashboard.api.sinceColumn"), cell: (row) => (row.since ? time(row.since) : t("admin.dashboard.api.none")) },
              { header: t("admin.dashboard.api.renewsAtColumn"), cell: (row) => (row.renewsAt ? time(row.renewsAt) : t("admin.dashboard.api.none")) },
              { header: t("admin.dashboard.api.links"), cell: links },
            ]}
            rows={rows}
            rowKey={(row) => row.toolId}
          />
        </>
      )}
    </section>
  );
}
