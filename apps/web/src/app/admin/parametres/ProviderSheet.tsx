import { isFranceTravailApi } from "@jobhub/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { parametresHref, settingHref, type PossibleProvider } from "@/platform-settings/parametres";
import type { ApiAccess, ProviderApiAccess, ProviderSecretStatus } from "@/provider-secrets/index";
import { routes } from "@/routes";
import { clearSecret, replaceSecret, testSecret } from "./actions";
import { Here, type Ctx } from "./context";
import { KeyCell, LastTest, usedByLabel } from "./ProvidersSection";

/**
 * A provider's sheet, in a side panel over its tab (#396): its Provider Secrets (replaced, cleared and tested by
 * super-admins only, ADR-0020: a value goes in, never out), the keys env alone holds, its own settings and what it
 * serves, each of its APIs' access at its latest connection test (France Travail's, #400), and a link to its Outils
 * page, where its calls are.
 */
export function ProviderSheet({
  ctx,
  row,
  secrets,
  apiAccess,
  notices,
}: {
  ctx: Ctx;
  row: PossibleProvider;
  secrets: readonly ProviderSecretStatus[] | null;
  apiAccess: readonly ProviderApiAccess[];
  notices: ReactNode;
}) {
  const { t, tab } = ctx;
  const { tool } = row;
  const statusOf = (name: string) => secrets?.find((secret) => secret.name === name);
  const purpose = ctx.locale === "en" ? tool.purpose.en : tool.purpose.fr;

  return (
    <aside className="side-sheet stack" aria-labelledby="sheet-title" data-sheet={tool.id}>
      <div className="side-sheet-head">
        <h2 id="sheet-title">{tool.name}</h2>
        <Link prefetch={false} className="button" href={parametresHref(tab.id)}>
          {t("admin.platformSettings.sheet.close")}
        </Link>
      </div>
      <p>{purpose}</p>
      {notices}
      <p>
        <span className="pill">{t(`admin.tools.statuses.${row.status}`)}</span>
        {row.usedBy.length > 0 ? <> {t("admin.platformSettings.providers.usedBy")} : {row.usedBy.map((used) => usedByLabel(ctx, used)).join(", ")}</> : null}
      </p>
      {row.status === "awaiting_access" ? <p>{t("admin.tools.accessRefused", { provider: tool.name })}</p> : null}

      <section className="stack" aria-labelledby="sheet-keys">
        <h3 id="sheet-keys">{t("admin.platformSettings.sheet.keysTitle")}</h3>
        {row.keys.length === 0 ? <p>{t("admin.platformSettings.providers.noKeys")}</p> : null}
        {row.keys.length > 0 && !ctx.can.secrets ? <p>{t("admin.platformSettings.sheet.readOnlyKeys")}</p> : null}
        {row.keys.map((key) => {
          const status = statusOf(key.name);
          return (
            <div key={key.name} className="stack" data-key={key.name}>
              <KeyCell ctx={ctx} keyState={key} />
              <LastTest ctx={ctx} keyState={key} />
              {status?.updatedBy && status.updatedAt ? (
                <p>
                  {t("admin.providerSecrets.changed")} : {status.updatedBy}, <time dateTime={status.updatedAt.toISOString()}>{ctx.at.format(status.updatedAt)}</time>
                </p>
              ) : null}
              {!key.secret ? <p>{t("admin.platformSettings.sheet.notSecretHelp")}</p> : null}
              {key.secret && status?.source === "missing" ? <p>{t("admin.providerSecrets.missingHelp")}</p> : null}
              {key.secret && status?.source === "unreadable" ? <p>{t("admin.providerSecrets.unreadableHelp")}</p> : null}
              {key.secret && ctx.can.secrets ? <SecretActions ctx={ctx} name={key.name} source={status?.source} /> : null}
            </div>
          );
        })}
      </section>

      {apiAccess.length > 0 ? <ApiAccessTable ctx={ctx} apiAccess={apiAccess} /> : null}

      <section className="stack" aria-labelledby="sheet-settings">
        <h3 id="sheet-settings">{t("admin.platformSettings.sheet.settingsTitle")}</h3>
        {row.settings.length === 0 ? (
          <p>{t("admin.platformSettings.sheet.noSettings")}</p>
        ) : (
          <ul>
            {row.settings.map((setting) => (
              <li key={setting.name}>
                <Link prefetch={false} href={settingHref(setting.name)}>
                  <code>{setting.name}</code>
                </Link>{" "}
                = {setting.value ? <code>{setting.value}</code> : t("admin.platformSettings.empty")} ({t(`admin.platformSettings.sources.${setting.source}`)})
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link prefetch={false} href={routes.adminTool(tool.id)}>{t("admin.platformSettings.sheet.toolPage")}</Link>
      </p>
    </aside>
  );
}

const ACCESS_TONE: Record<ApiAccess, "success" | "danger"> = { ok: "success", refused: "danger", error: "danger" };

/** Each API of the provider as the latest test of the keys in use found it (#400): France Travail's passes once the client is valid, whatever API it lacks. */
function ApiAccessTable({ ctx, apiAccess }: { ctx: Ctx; apiAccess: readonly ProviderApiAccess[] }) {
  const { t } = ctx;
  return (
    <section className="stack" aria-labelledby="sheet-api-access">
      <h3 id="sheet-api-access">{t("admin.providerSecrets.apiAccess.title")}</h3>
      <p>{t("admin.providerSecrets.apiAccess.intro", { at: ctx.at.format(apiAccess[0]!.testedAt) })}</p>
      <div className="table-scroll">
        <table className="application-table">
          <caption className="visually-hidden">{t("admin.providerSecrets.apiAccess.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.providerSecrets.apiAccess.api")}</th>
              <th scope="col">{t("admin.providerSecrets.apiAccess.state")}</th>
            </tr>
          </thead>
          <tbody>
            {apiAccess.map(({ api, state }) => (
              <tr key={api}>
                <th scope="row">{isFranceTravailApi(api) ? t(`admin.providerSecrets.apiAccess.apis.${api}`) : api}</th>
                <td>
                  <span className="pill" data-tone={ACCESS_TONE[state]}>
                    {t(`admin.providerSecrets.apiAccess.states.${state}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A super-admin's actions on one Provider Secret: test the key in use, clear the database's, replace it (write-only, tested first). */
function SecretActions({ ctx, name, source }: { ctx: Ctx; name: string; source: ProviderSecretStatus["source"] | undefined }) {
  const { t } = ctx;
  return (
    <div className="stack">
      <div className="provider-secret-actions">
        {source && source !== "missing" ? (
          <form action={testSecret}>
            <Here ctx={ctx} />
            <input type="hidden" name="name" value={name} />
            <button className="button" type="submit">
              {t("admin.providerSecrets.test", { name })}
            </button>
          </form>
        ) : null}
        {source === "database" || source === "unreadable" ? (
          <form action={clearSecret}>
            <Here ctx={ctx} />
            <input type="hidden" name="name" value={name} />
            <button className="button" type="submit">
              {t("admin.providerSecrets.clear", { name })}
            </button>
          </form>
        ) : null}
      </div>
      {ctx.canSaveSecrets ? (
        <details className="provider-secret-replace">
          <summary>{t("admin.providerSecrets.replaceLegend", { name })}</summary>
          {/* Write-only: the field is always empty, the value saved is never sent back. */}
          <form className="stack quota-form" action={replaceSecret}>
            <Here ctx={ctx} />
            <input type="hidden" name="name" value={name} />
            <fieldset>
              <legend className="visually-hidden">{t("admin.providerSecrets.replaceLegend", { name })}</legend>
              <div className="stack">
                <label htmlFor={`value-${name}`}>{t("admin.providerSecrets.newValue", { name })}</label>
                <input id={`value-${name}`} className="input" name="value" type="password" required autoComplete="new-password" spellCheck={false} aria-describedby={`value-${name}-help`} />
                <p id={`value-${name}-help`}>{t("admin.providerSecrets.newValueHelp")}</p>
              </div>
              <div className="checkbox-field">
                <input id={`anyway-${name}`} type="checkbox" name="saveAnyway" aria-describedby={`anyway-${name}-help`} />
                <label htmlFor={`anyway-${name}`}>{t("admin.providerSecrets.saveAnyway")}</label>
                <p id={`anyway-${name}-help`}>{t("admin.providerSecrets.saveAnywayHelp")}</p>
              </div>
              <button className="button button-primary" type="submit">
                {t("admin.providerSecrets.replace", { name })}
              </button>
            </fieldset>
          </form>
        </details>
      ) : null}
    </div>
  );
}
