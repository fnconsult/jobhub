import type { AiTask } from "@jobhub/ai";
import Link from "next/link";
import { ExplainableLabel, type ExplainedContext } from "@/components/ExplainableLabel";
import type { EnvOnlyRow } from "@/platform-settings/env-only";
import { parametresHref, type KeyState, type PossibleProvider } from "@/platform-settings/parametres";
import type { ResolvedPlatformSetting } from "@/platform-settings/resolver";
import { saveSetting } from "./actions";
import { Here, ScrollFrame, type Ctx } from "./context";
import { tabNameOf } from "./SettingName";
import { SettingsTable } from "./SettingsTable";

/** A missing-key warning, as an Explainable label explains it (#407). */
const KEY_MISSING: ExplainedContext = { kind: "warning", id: "key_missing" };
const ACTIVE_NO_KEY = "active-no-key";

/**
 * « Pourquoi ? » after a missing-key warning (#407): asks the Back Office Assistant why, with the provider and the keys
 * it lacks (by name, never a value).
 */
function WhyMissingKey({ ctx, warning, warningId, rows }: { ctx: Ctx; warning: string; warningId: string; rows: readonly PossibleProvider[] }) {
  const missing = rows.flatMap((row) => row.keys.filter((key) => !key.set).map((key) => key.name));
  return (
    <ExplainableLabel
      subject={warning}
      describedBy={warningId}
      item={{ ...KEY_MISSING, tab: tabNameOf(ctx), source: rows.map((row) => row.tool.name).join(", "), state: missing.join(", ") }}
    >
      {ctx.t("admin.platformSettings.explain.why")}
    </ExplainableLabel>
  );
}

const KEY_TONE: Record<NonNullable<KeyState["source"]>, "success" | "accent" | "danger"> = { database: "success", env: "accent", missing: "danger", unreadable: "danger" };
const STATUS_TONE: Record<PossibleProvider["status"], "success" | "accent" | "danger" | undefined> = {
  configured: "success",
  no_key_needed: "success",
  disabled: undefined,
  key_missing: "danger",
  setting_missing: "danger",
  awaiting_access: "danger",
  not_configured: "accent",
};

/** What a possible provider serves, in words: an AI task by its AI Usage name, the identity route, or a feature. */
export function usedByLabel(ctx: Ctx, used: string): string {
  return isFeature(used) ? ctx.t(`admin.platformSettings.providers.usedByValues.${used}`) : ctx.t(`admin.aiUsage.tasks.${used as AiTask}`);
}
const USED_BY_FEATURES = ["identity", "job_discovery", "enriched_contacts", "email", "billing", "sign_in"] as const;
const isFeature = (used: string): used is (typeof USED_BY_FEATURES)[number] => (USED_BY_FEATURES as readonly string[]).includes(used);

/** A key as the providers' table shows it: its name, its source and last 4 characters to who reads the Provider Secrets, else set or missing. */
export function KeyCell({ ctx, keyState }: { ctx: Ctx; keyState: KeyState }) {
  const { t } = ctx;
  return (
    <p>
      <code>{keyState.name}</code>{" "}
      {keyState.source ? (
        <span className="pill" data-tone={KEY_TONE[keyState.source]}>
          {t(`admin.providerSecrets.sources.${keyState.source}`)}
        </span>
      ) : (
        <span className="pill" data-tone={keyState.set ? "success" : "danger"}>
          {t(keyState.set ? "admin.platformSettings.providers.keySet" : "admin.platformSettings.providers.keyMissing")}
        </span>
      )}
      {keyState.fingerprint ? <> …{keyState.fingerprint}</> : null}
      {keyState.secret ? null : <> ({t("admin.platformSettings.providers.notSecret")})</>}
    </p>
  );
}

/** A key's last connection test: when, and whether it passed; « Jamais testée » before any. */
export function LastTest({ ctx, keyState }: { ctx: Ctx; keyState: KeyState }) {
  const { t } = ctx;
  if (!keyState.secret || keyState.lastTest === undefined) return null;
  if (keyState.lastTest === null) return <p>{t("admin.platformSettings.providers.neverTested")}</p>;
  const { at, passed } = keyState.lastTest;
  return (
    <p>
      <code>{keyState.name}</code>{" "}
      <time dateTime={at.toISOString()} data-tone={passed ? "success" : "danger"} className="pill">
        {t(passed ? "admin.platformSettings.providers.testPassed" : "admin.platformSettings.providers.testFailed", { at: ctx.at.format(at) })}
      </time>
    </p>
  );
}

/**
 * A provider tab (#396): the « Fournisseur actif » card (the active provider, or those in service, and the tab's
 * settings with their value, source, default and « Rétablir ») then « Fournisseurs possibles »: one row per Tool of the
 * tab's kind with its keys, last connection test, state, own settings, what it serves, its sheet and « Rendre actif ».
 */
export function ProvidersSection({
  ctx,
  rows,
  settings,
  envOnly,
}: {
  ctx: Ctx;
  rows: readonly PossibleProvider[];
  settings: readonly ResolvedPlatformSetting[];
  envOnly: readonly EnvOnlyRow[];
}) {
  const { t, tab } = ctx;
  const tabName = t(`admin.platformSettings.tabs.${tab.id}`);
  const active = tab.activeSetting ? rows.filter((row) => row.active) : rows.filter((row) => row.usedBy.length > 0);
  const missingKey = (row: PossibleProvider) => row.keys.some((key) => !key.set);

  return (
    <>
      <section className="card stack" aria-labelledby="active-provider">
        <h2 id="active-provider">{t(tab.toolCategories.length > 0 ? "admin.platformSettings.active.title" : "admin.platformSettings.active.settingsTitle")}</h2>
        {tab.toolCategories.length === 0 ? null : tab.activeSetting ? (
          <p className="lead" data-active-provider>
            {active.length > 0 ? active.map((row) => row.tool.name).join(", ") : t("admin.platformSettings.active.none")}
          </p>
        ) : (
          <p data-active-provider>{t("admin.platformSettings.active.inUse", { names: active.length > 0 ? active.map((row) => row.tool.name).join(", ") : t("admin.platformSettings.active.none") })}</p>
        )}
        {tab.activeSetting && active.some(missingKey) ? (
          <p className="notice">
            <span id={ACTIVE_NO_KEY}>{t("admin.platformSettings.active.noKey")}</span>{" "}
            <WhyMissingKey ctx={ctx} warning={t("admin.platformSettings.active.noKey")} warningId={ACTIVE_NO_KEY} rows={active.filter(missingKey)} />
          </p>
        ) : null}
        {tab.id === "contact_enrichment" ? <p>{t("admin.platformSettings.enrichedContactsHelp")}</p> : null}
        <SettingsTable ctx={ctx} caption={t("admin.platformSettings.active.settingsCaption", { tab: tabName })} names={tab.settings} settings={settings} envOnly={envOnly} />
      </section>

      {rows.length > 0 ? (
        <section className="stack" aria-labelledby="possible-providers">
          <h2 id="possible-providers">{t("admin.platformSettings.providers.title")}</h2>
          <ScrollFrame label={t("admin.platformSettings.providers.caption", { tab: tabName })}>
            <table className="application-table">
              <caption className="visually-hidden">{t("admin.platformSettings.providers.caption", { tab: tabName })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.platformSettings.providers.provider")}</th>
                  <th scope="col">{t("admin.platformSettings.providers.keys")}</th>
                  <th scope="col">{t("admin.platformSettings.providers.lastTest")}</th>
                  <th scope="col">{t("admin.platformSettings.providers.status")}</th>
                  <th scope="col">{t("admin.platformSettings.providers.settings")}</th>
                  <th scope="col">{t("admin.platformSettings.providers.usedBy")}</th>
                  {tab.activeSetting && ctx.can.settings ? <th scope="col">{t("admin.platformSettings.providers.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tool.id} data-provider={row.tool.id}>
                    <th scope="row">
                      <Link prefetch={false} href={parametresHref(tab.id, { fournisseur: row.tool.id })} aria-label={t("admin.platformSettings.providers.open", { name: row.tool.name })}>
                        {row.tool.name}
                      </Link>
                      {row.active ? (
                        <>
                          {" "}
                          <span className="pill" data-tone="success">
                            {t("admin.platformSettings.providers.activeFlag")}
                          </span>
                        </>
                      ) : null}
                    </th>
                    <td>{row.keys.length > 0 ? row.keys.map((key) => <KeyCell key={key.name} ctx={ctx} keyState={key} />) : t("admin.platformSettings.providers.noKeys")}</td>
                    <td>{row.keys.some((key) => key.lastTest !== undefined) ? row.keys.map((key) => <LastTest key={key.name} ctx={ctx} keyState={key} />) : t("admin.platformSettings.providers.none")}</td>
                    <td>
                      <span className="pill" data-tone={STATUS_TONE[row.status]}>
                        {t(`admin.tools.statuses.${row.status}`)}
                      </span>
                    </td>
                    <td>
                      {row.settings.length > 0
                        ? row.settings.map((setting) => (
                            <p key={setting.name}>
                              <code>{setting.name}</code> = {setting.value ? <code>{setting.value}</code> : t("admin.platformSettings.empty")}
                            </p>
                          ))
                        : t("admin.platformSettings.providers.none")}
                    </td>
                    <td>{row.usedBy.length > 0 ? row.usedBy.map((used) => usedByLabel(ctx, used)).join(", ") : t("admin.platformSettings.providers.none")}</td>
                    {tab.activeSetting && ctx.can.settings ? (
                      <td>
                        {row.selectable ? (
                          <form className="stack" action={saveSetting}>
                            <Here ctx={ctx} />
                            <input type="hidden" name="name" value={tab.activeSetting} />
                            <input type="hidden" name="value" value={row.tool.id} />
                            <button className="button" type="submit" aria-describedby={missingKey(row) ? `no-key-${row.tool.id}` : undefined}>
                              {t("admin.platformSettings.providers.makeActive")}
                              <span className="visually-hidden"> : {row.tool.name}</span>
                            </button>
                            {missingKey(row) ? (
                              <p>
                                <span id={`no-key-${row.tool.id}`}>{t("admin.platformSettings.providers.noKeyWarning")}</span>{" "}
                                <WhyMissingKey ctx={ctx} warning={t("admin.platformSettings.providers.noKeyWarning")} warningId={`no-key-${row.tool.id}`} rows={[row]} />
                              </p>
                            ) : null}
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        </section>
      ) : null}
    </>
  );
}
