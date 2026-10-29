import { buttonClass } from "@/design/button-class";
import { Pill } from "@/design/Pill";
import { JOB_DISCOVERY_SOURCES, type JobDiscoverySource } from "@jobhub/shared";
import Link from "next/link";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { ExplainableLabel } from "@/components/ExplainableLabel";
import type { EmailIntakeHeldBack } from "@/email-intake/playbook-state";
import { EMAIL_INTAKE_TOOL, providerSheetHref, type PossibleProvider } from "@/platform-settings/parametres";
import { setJobDiscoverySource, testSecret } from "./actions";
import { Table } from "@/design/Table";
import { Here, type Ctx } from "./context";
import { KeyCell } from "./ProvidersSection";
import { tabNameOf } from "./SettingName";

/** What a source's Explainable label is (#407). */
const SOURCE = "source";

/** The Tools each Job discovery source calls: the web search's is the active Search provider. */
const SOURCE_TOOLS: Record<Exclude<JobDiscoverySource, "web_search">, readonly string[]> = {
  france_travail: ["france-travail"],
  fantastic_jobs: ["fantastic-jobs"],
  ats_apis: ["greenhouse", "lever", "ashby"],
  email_intake: [EMAIL_INTAKE_TOOL],
};

/** Why a source counts as off whatever its switch (CONTEXT.md: Held back): Email intake while its Task Playbook is not served. */
export type HeldBack = Partial<Record<JobDiscoverySource, EmailIntakeHeldBack | null>>;

/** Why a source is unavailable, or null: switched off here first, then held back, then its providers' state, as Outils says it. */
function unavailable(ctx: Ctx, enabled: boolean, providers: readonly PossibleProvider[], heldBack: EmailIntakeHeldBack | null | undefined): string | null {
  const { t } = ctx;
  if (!enabled) return t("admin.platformSettings.sources.reasons.switched_off");
  if (heldBack) return t(`admin.platformSettings.sources.reasons.${heldBack}`);
  if (providers.length === 0) return t("admin.platformSettings.sources.reasons.not_configured");
  const blocked = providers.find((row) => row.status !== "configured" && row.status !== "no_key_needed");
  if (!blocked) return null;
  if (blocked.status === "key_missing") return t("admin.platformSettings.sources.reasons.key_missing", { names: blocked.missingKeys.join(", ") });
  // France Travail without Offres d'emploi at its latest connection test (#400): runs go on without it.
  if (blocked.status === "awaiting_access") return t("admin.searchSites.sources.accessRefused");
  if (blocked.status === "setting_missing") return t("admin.platformSettings.sources.reasons.setting_missing", { names: blocked.missingSettings.join(", ") });
  return t(`admin.platformSettings.sources.reasons.${blocked.status === "disabled" ? "disabled" : "not_configured"}`);
}

/**
 * The Sources tab's table (#396, moved from Sites de recherche): every Job discovery source with its switch, the
 * provider it calls (the web search's: the active Search provider), its keys, a test of each, and why it is
 * unavailable when it is: Email intake (#448) also while held back by its Task Playbook, its provider's sheet being the
 * Email intake sheet.
 */
export function SourcesSection({
  ctx,
  sources,
  rows,
  webSearch,
  heldBack = {},
}: {
  ctx: Ctx;
  sources: Record<JobDiscoverySource, boolean>;
  rows: readonly PossibleProvider[];
  webSearch: PossibleProvider | undefined;
  heldBack?: HeldBack;
}) {
  const { t } = ctx;
  const providersOf = (source: JobDiscoverySource): PossibleProvider[] =>
    source === "web_search" ? (webSearch ? [webSearch] : []) : SOURCE_TOOLS[source].flatMap((id) => rows.filter((row) => row.tool.id === id));

  return (
    <section className="stack" aria-labelledby="sources-title">
      <h2 id="sources-title">{t("admin.platformSettings.sources.title")}</h2>
      <p>{t("admin.platformSettings.sources.intro")}</p>
      <Table
        label={t("admin.platformSettings.sources.caption")}
        columns={[
          {
            header: t("admin.platformSettings.sources.source"),
            rowHeader: true,
            cell: ({ source, name, enabled, providers, why }) => (
              <ExplainableLabel
                item={{
                  kind: SOURCE,
                  id: source,
                  tab: tabNameOf(ctx),
                  value: t(enabled ? "admin.searchSites.enabled" : "admin.searchSites.disabled"),
                  source: providers.map((row) => row.tool.name).join(", ") || t("admin.platformSettings.active.none"),
                  state: why ?? t("admin.platformSettings.sources.available"),
                }}
              >
                {name}
              </ExplainableLabel>
            ),
          },
          {
            header: t("admin.searchSites.status"),
            cell: ({ enabled, providers }) => (
              <>
                {t(enabled ? "admin.searchSites.enabled" : "admin.searchSites.disabled")}
                {providers.some((row) => row.status === "awaiting_access") ? (
                  <>
                    {" "}
                    <Pill tone="danger">{t("admin.searchSites.sources.awaitingAccess")}</Pill>
                  </>
                ) : null}
              </>
            ),
          },
          {
            header: t("admin.platformSettings.sources.switch"),
            cell: ({ source, name, enabled }) => (
              <BackOfficeForm canWrite={ctx.can.sites} action={setJobDiscoverySource}>
                <Here ctx={ctx} />
                <input type="hidden" name="source" value={source} />
                <input type="hidden" name="enabled" value={String(!enabled)} />
                <button className={buttonClass({ size: "sm" })} type="submit" disabled={!ctx.can.sites}>
                  {t(enabled ? "admin.searchSites.disable" : "admin.searchSites.enable", { name })}
                </button>
              </BackOfficeForm>
            ),
          },
          {
            header: t("admin.platformSettings.sources.provider"),
            cell: ({ providers }) =>
              providers.length > 0
                ? providers.map((row) => (
                    <p key={row.tool.id}>
                      <Link prefetch={false} href={providerSheetHref(row.tool)!} data-opens-sheet={row.tool.id}>
                        {row.tool.name}
                      </Link>
                    </p>
                  ))
                : t("admin.platformSettings.active.none"),
          },
          {
            header: t("admin.platformSettings.sources.keys"),
            cell: ({ keys }) => (keys.length > 0 ? keys.map((key) => <KeyCell key={key.name} ctx={ctx} keyState={key} />) : t("admin.platformSettings.sources.noKeyNeeded")),
          },
          {
            header: t("admin.platformSettings.sources.test"),
            cell: ({ keys }) =>
              ctx.can.secrets
                ? keys
                    .filter((key) => key.secret && key.set)
                    .map((key) => (
                      <form key={key.name} action={testSecret}>
                        <Here ctx={ctx} />
                        <input type="hidden" name="name" value={key.name} />
                        <button className={buttonClass({ size: "sm" })} type="submit">
                          {t("admin.platformSettings.sources.testKey", { name: key.name })}
                        </button>
                      </form>
                    ))
                : null,
          },
          { header: t("admin.platformSettings.sources.why"), cell: ({ why }) => why ?? t("admin.platformSettings.sources.available") },
        ]}
        rows={JOB_DISCOVERY_SOURCES.map((source) => {
          const enabled = sources[source];
          const providers = providersOf(source);
          return {
            source,
            name: t(`admin.searchSites.sources.names.${source}`),
            enabled,
            providers,
            keys: providers.flatMap((row) => row.keys),
            why: unavailable(ctx, enabled, providers, heldBack[source]),
          };
        })}
        rowKey={({ source }) => source}
        rowAttributes={({ source }) => ({ "data-source": source })}
      />
    </section>
  );
}
