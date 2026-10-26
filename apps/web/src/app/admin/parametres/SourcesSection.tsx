import { JOB_DISCOVERY_SOURCES, type JobDiscoverySource } from "@jobhub/shared";
import Link from "next/link";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { providerSheetHref, type PossibleProvider } from "@/platform-settings/parametres";
import { setJobDiscoverySource, testSecret } from "./actions";
import { Here, type Ctx } from "./context";
import { KeyCell } from "./ProvidersSection";

/** The Tools each Job discovery source calls: the web search's is the active Search provider. */
const SOURCE_TOOLS: Record<Exclude<JobDiscoverySource, "web_search">, readonly string[]> = {
  france_travail: ["france-travail"],
  fantastic_jobs: ["fantastic-jobs"],
  ats_apis: ["greenhouse", "lever", "ashby"],
};

/** Why a source is unavailable, or null: switched off here first, then its providers' state, as Outils says it. */
function unavailable(ctx: Ctx, enabled: boolean, providers: readonly PossibleProvider[]): string | null {
  const { t } = ctx;
  if (!enabled) return t("admin.platformSettings.sources.reasons.switched_off");
  if (providers.length === 0) return t("admin.platformSettings.sources.reasons.not_configured");
  const blocked = providers.find((row) => row.status !== "configured" && row.status !== "no_key_needed");
  if (!blocked) return null;
  if (blocked.status === "key_missing") return t("admin.platformSettings.sources.reasons.key_missing", { names: blocked.missingKeys.join(", ") });
  if (blocked.status === "setting_missing") return t("admin.platformSettings.sources.reasons.setting_missing", { names: blocked.missingSettings.join(", ") });
  return t(`admin.platformSettings.sources.reasons.${blocked.status === "disabled" ? "disabled" : "not_configured"}`);
}

/**
 * The Sources tab's table (#396, moved from Sites de recherche): every Job discovery source with its switch, the
 * provider it calls (the web search's: the active Search provider), its keys, a test of each, and why it is
 * unavailable when it is.
 */
export function SourcesSection({ ctx, sources, rows, webSearch }: { ctx: Ctx; sources: Record<JobDiscoverySource, boolean>; rows: readonly PossibleProvider[]; webSearch: PossibleProvider | undefined }) {
  const { t } = ctx;
  const providersOf = (source: JobDiscoverySource): PossibleProvider[] =>
    source === "web_search" ? (webSearch ? [webSearch] : []) : SOURCE_TOOLS[source].flatMap((id) => rows.filter((row) => row.tool.id === id));

  return (
    <section className="stack" aria-labelledby="sources-title">
      <h2 id="sources-title">{t("admin.platformSettings.sources.title")}</h2>
      <p>{t("admin.platformSettings.sources.intro")}</p>
      <div className="table-scroll">
        <table className="application-table">
          <caption className="visually-hidden">{t("admin.platformSettings.sources.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.platformSettings.sources.source")}</th>
              <th scope="col">{t("admin.platformSettings.sources.switch")}</th>
              <th scope="col">{t("admin.platformSettings.sources.provider")}</th>
              <th scope="col">{t("admin.platformSettings.sources.keys")}</th>
              <th scope="col">{t("admin.platformSettings.sources.test")}</th>
              <th scope="col">{t("admin.platformSettings.sources.why")}</th>
            </tr>
          </thead>
          <tbody>
            {JOB_DISCOVERY_SOURCES.map((source) => {
              const name = t(`admin.searchSites.sources.names.${source}`);
              const enabled = sources[source];
              const providers = providersOf(source);
              const keys = providers.flatMap((row) => row.keys);
              const why = unavailable(ctx, enabled, providers);
              return (
                <tr key={source} data-source={source}>
                  <th scope="row">{name}</th>
                  <td>
                    <p>{t(enabled ? "admin.searchSites.enabled" : "admin.searchSites.disabled")}</p>
                    <BackOfficeForm canWrite={ctx.can.sites} action={setJobDiscoverySource}>
                      <Here ctx={ctx} />
                      <input type="hidden" name="source" value={source} />
                      <input type="hidden" name="enabled" value={String(!enabled)} />
                      <button className="button" type="submit" disabled={!ctx.can.sites}>
                        {t(enabled ? "admin.searchSites.disable" : "admin.searchSites.enable", { name })}
                      </button>
                    </BackOfficeForm>
                  </td>
                  <td>
                    {providers.length > 0
                      ? providers.map((row) => (
                          <p key={row.tool.id}>
                            <Link href={providerSheetHref(row.tool)!}>{row.tool.name}</Link>
                          </p>
                        ))
                      : t("admin.platformSettings.active.none")}
                  </td>
                  <td>{keys.length > 0 ? keys.map((key) => <KeyCell key={key.name} ctx={ctx} keyState={key} />) : t("admin.platformSettings.sources.noKeyNeeded")}</td>
                  <td>
                    {ctx.can.secrets
                      ? keys
                          .filter((key) => key.secret && key.set)
                          .map((key) => (
                            <form key={key.name} action={testSecret}>
                              <Here ctx={ctx} />
                              <input type="hidden" name="name" value={key.name} />
                              <button className="button" type="submit">
                                {t("admin.platformSettings.sources.testKey", { name: key.name })}
                              </button>
                            </form>
                          ))
                      : null}
                  </td>
                  <td>{why ?? t("admin.platformSettings.sources.available")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
