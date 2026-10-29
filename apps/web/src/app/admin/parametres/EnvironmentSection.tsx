import Link from "next/link";
import { BACK_OFFICE_PAGES, readsPage, type BackOfficePage } from "@/admin/back-office-nav";
import type { EnvOnlyRow, retiredSettingsSet } from "@/platform-settings/env-only";
import { Note } from "@/design/Note";
import { Table } from "@/design/Table";
import type { Ctx } from "./context";
import { ExplainableLabel, type ExplainedContext } from "@/components/ExplainableLabel";
import { SettingName } from "./SettingName";
import { ShownEnvValue, shownEnvText } from "./SettingsTable";

/** The settings with a section of their own, linked from Environnement (ADR-0033). */
const ELSEWHERE: BackOfficePage[] = ["planQuotas", "guardrails", "coachCost"];

/** The tab's intro, as an Explainable label explains it (#407). */
const INTRO: ExplainedContext = { kind: "intro", id: "environment" };

/**
 * The Environnement tab (#396, last): what only the server's environment holds, read-only, each with why it stays
 * there (ADR-0033), never a secret; the variables Jobbbox no longer reads that it still sets; and the settings that
 * have a section of their own.
 */
export function EnvironmentSection({ ctx, rows, retired }: { ctx: Ctx; rows: readonly EnvOnlyRow[]; retired: ReturnType<typeof retiredSettingsSet> }) {
  const { t } = ctx;
  const elsewhere = ELSEWHERE.filter((page) => readsPage(ctx.access, page));
  const kindOf = (row: EnvOnlyRow) => t(`admin.platformSettings.environment.kinds.${row.kind === "bootstrap" ? "bootstrap" : "read_only"}`);
  return (
    <>
      <section className="stack" aria-labelledby="settings-env-only">
        <h2 id="settings-env-only">{t("admin.platformSettings.envOnly.title")}</h2>
        <p>
          {t("admin.platformSettings.envOnly.intro")}{" "}
          <ExplainableLabel subject={t("admin.platformSettings.envOnly.title")} item={{ ...INTRO, tab: t("admin.platformSettings.tabs.environment") }}>
            {t("admin.platformSettings.envOnly.why")}
          </ExplainableLabel>
        </p>
        {rows.some((row) => row.warning === "mail_to_console") ? (
          <Note tone="danger" role="alert">
            <p>{t("admin.platformSettings.envOnly.mailToConsole")}</p>
          </Note>
        ) : null}
        <Table
          label={t("admin.platformSettings.envOnly.caption")}
          columns={[
            {
              header: t("admin.platformSettings.setting"),
              rowHeader: true,
              cell: (row) => <SettingName ctx={ctx} name={row.name} item={{ value: shownEnvText(ctx, row.shown), source: t("admin.platformSettings.sources.env"), state: kindOf(row) }} />,
            },
            {
              header: t("admin.platformSettings.value"),
              cell: (row) => (
                <span data-value>
                  <ShownEnvValue ctx={ctx} value={row.shown} />
                </span>
              ),
            },
            { header: t("admin.platformSettings.environment.why"), cell: kindOf },
          ]}
          rows={rows}
          rowKey={(row) => row.name}
          rowAttributes={(row) => ({ id: `setting-${row.name}`, "data-setting": row.name })}
        />
      </section>

      <section className="stack" aria-labelledby="settings-retired">
        <h2 id="settings-retired">{t("admin.platformSettings.environment.retired.title")}</h2>
        {retired.length === 0 ? (
          <p>{t("admin.platformSettings.environment.retired.none")}</p>
        ) : (
          <>
            <p>{t("admin.platformSettings.environment.retired.intro")}</p>
            <Table
              label={t("admin.platformSettings.environment.retired.caption")}
              columns={[
                { header: t("admin.platformSettings.setting"), rowHeader: true, cell: (row) => <code>{row.name}</code> },
                { header: t("admin.platformSettings.environment.retired.replacedBy"), cell: (row) => t(`admin.platformSettings.environment.retired.by.${row.replacedBy}`) },
              ]}
              rows={retired}
              rowKey={(row) => row.name}
              rowAttributes={(row) => ({ "data-setting": row.name })}
            />
          </>
        )}
      </section>

      {elsewhere.length > 0 ? (
        <section className="stack" aria-labelledby="settings-elsewhere">
          <h2 id="settings-elsewhere">{t("admin.platformSettings.elsewhere.title")}</h2>
          <p>{t("admin.platformSettings.elsewhere.intro")}</p>
          <ul>
            {elsewhere.map((page) => (
              <li key={page}>
                <Link href={BACK_OFFICE_PAGES[page].href}>{t(`admin.sections.${page}`)}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
