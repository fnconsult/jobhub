import { isFranceTravailApi } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { isProviderSecretName, PROVIDER_SECRETS, type ProviderSecretName } from "@/provider-secrets/catalog";
import { secretCipherFromEnv } from "@/provider-secrets/cipher";
import type { ApiAccess, ProviderSecretSource } from "@/provider-secrets/index";
import { getProviderSecrets, getSecretResolver } from "@/provider-secrets/server";
import { routes } from "@/routes";

const ERRORS = ["test_failed", "empty", "too_long", "unknown_secret", "no_master_key"] as const;
type ErrorCode = (typeof ERRORS)[number];

const TONE: Record<ProviderSecretSource, "success" | "accent" | "danger"> = { database: "success", env: "accent", missing: "danger", unreadable: "danger" };
const ACCESS_TONE: Record<ApiAccess, "success" | "danger" | undefined> = { ok: "success", refused: "danger", error: "danger" };

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("providerSecrets");
  const t = await getServerT();
  return { title: `${t("admin.providerSecrets.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** The HTTP status a failed connection test quotes, if any: the only part of its detail the page shows. */
const statusIn = (detail: string): string | undefined => /\bHTTP (\d{3})\b/.exec(detail)?.[1];

/** Where the page goes after a change: what happened, by key name and code only. Never a value, nor a provider's answer. */
const back = (params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return `${routes.adminProviderSecrets}?${query}`;
};

async function replaceSecret(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("providerSecrets", "write");
  const name = form.get("name");
  const replaced = await getProviderSecrets().replace(administrator, name, form.get("value"), { saveAnyway: form.get("saveAnyway") === "on" });
  if (!replaced.ok) {
    redirect(back({ error: replaced.error, key: String(name), status: replaced.error === "test_failed" ? statusIn(replaced.detail) : undefined }));
  }
  // This process uses it at once; the others hear the NOTIFY.
  await getSecretResolver().refresh();
  redirect(back({ saved: String(name), test: replaced.test }));
}

async function clearSecret(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("providerSecrets", "write");
  const name = form.get("name");
  const cleared = await getProviderSecrets().clear(administrator, name);
  if (!cleared.ok) redirect(back({ error: cleared.error }));
  await getSecretResolver().refresh();
  redirect(back({ cleared: String(name) }));
}

async function testSecret(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("providerSecrets", "write");
  const name = form.get("name");
  if (!isProviderSecretName(name)) redirect(back({ error: "unknown_secret" }));
  const tested = await getProviderSecrets().test(administrator, name);
  redirect(back({ tested: name, result: tested.ok ? "passed" : "failed", status: tested.ok ? undefined : statusIn(tested.detail) }));
}

type Search = { saved?: string; test?: string; cleared?: string; tested?: string; result?: string; status?: string; error?: string; key?: string };

/**
 * Super-admins manage the Provider Secrets: where each key's value comes from, its
 * last 4 characters, who changed it and when; replace it (write-only, tested first),
 * clear it (back to env), or test the one in use. No value is ever sent to the browser.
 */
export default async function ProviderSecretsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { access, canWrite } = await requireBackOffice("providerSecrets");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const search = await searchParams;
  const [secrets, franceTravail] = await Promise.all([getProviderSecrets().list(), getProviderSecrets().apiAccess("france-travail")]);
  const cipher = secretCipherFromEnv(process.env);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  // Only key names and codes from the address bar are shown, each checked against the known ones.
  const named = (value: string | undefined): ProviderSecretName | undefined => (isProviderSecretName(value) ? value : undefined);
  const status = /^\d{3}$/.test(search.status ?? "") ? search.status : undefined;
  const error = ERRORS.includes(search.error as ErrorCode) ? (search.error as ErrorCode) : undefined;
  const versions = [...new Set(secrets.flatMap((secret) => (secret.keyVersion === null ? [] : [secret.keyVersion])))].sort((a, b) => a - b);
  const canSave = canWrite && cipher !== null;

  const notices: { role: "status" | "alert"; text: string }[] = [];
  const saved = named(search.saved);
  if (saved) notices.push({ role: "status", text: t(search.test === "failed" ? "admin.providerSecrets.savedUntested" : "admin.providerSecrets.saved", { name: saved }) });
  const cleared = named(search.cleared);
  if (cleared) notices.push({ role: "status", text: t("admin.providerSecrets.cleared", { name: cleared }) });
  const tested = named(search.tested);
  if (tested) {
    const passed = search.result === "passed";
    notices.push({ role: passed ? "status" : "alert", text: t(passed ? "admin.providerSecrets.testPassed" : "admin.providerSecrets.testFailed", { name: tested }) });
  }
  if (error) notices.push({ role: "alert", text: t(`admin.providerSecrets.errors.${error}`, { name: named(search.key) ?? "" }) });
  if (status && (error === "test_failed" || (tested && search.result !== "passed"))) notices.push({ role: "alert", text: t("admin.providerSecrets.status", { status }) });

  return (
    <BackOfficeLayout access={access} title={t("admin.providerSecrets.title")}>
      <p className="lead">{t("admin.providerSecrets.intro")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {cipher ? null : <p className="notice">{t("admin.providerSecrets.noMasterKey")}</p>}
      {notices.map((notice) => (
        <p key={notice.text} className="notice" role={notice.role}>
          {notice.text}
        </p>
      ))}

      <div className="table-scroll">
        <table className="application-table provider-secrets">
          <caption>{t("admin.providerSecrets.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.providerSecrets.key")}</th>
              <th scope="col">{t("admin.providerSecrets.source")}</th>
              <th scope="col">{t("admin.providerSecrets.fingerprint")}</th>
              <th scope="col">{t("admin.providerSecrets.changed")}</th>
              {canWrite ? <td /> : null}
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => (
              <tr key={secret.name}>
                <th scope="row">
                  <code>{secret.name}</code>
                  <br />
                  {t(`admin.providerSecrets.providers.${secret.provider}`)}
                </th>
                <td>
                  <span className="pill" data-tone={TONE[secret.source]}>
                    {t(`admin.providerSecrets.sources.${secret.source}`)}
                  </span>
                  {secret.source === "missing" ? <p>{t("admin.providerSecrets.missingHelp")}</p> : null}
                  {secret.source === "unreadable" ? <p>{t("admin.providerSecrets.unreadableHelp")}</p> : null}
                </td>
                <td>{secret.fingerprint ? <code>…{secret.fingerprint}</code> : t("admin.providerSecrets.noFingerprint")}</td>
                <td>
                  {secret.updatedBy && secret.updatedAt ? (
                    <>
                      {secret.updatedBy}
                      <br />
                      <time dateTime={secret.updatedAt.toISOString()}>{at.format(secret.updatedAt)}</time>
                    </>
                  ) : (
                    t("admin.providerSecrets.never")
                  )}
                </td>
                {canWrite ? (
                  <td>
                    <div className="provider-secret-actions">
                      {secret.source === "missing" ? null : (
                        <form action={testSecret}>
                          <input type="hidden" name="name" value={secret.name} />
                          <button className="button" type="submit">
                            {t("admin.providerSecrets.test", { name: secret.name })}
                          </button>
                        </form>
                      )}
                      {secret.source === "database" || secret.source === "unreadable" ? (
                        <form action={clearSecret}>
                          <input type="hidden" name="name" value={secret.name} />
                          <button className="button" type="submit">
                            {t("admin.providerSecrets.clear", { name: secret.name })}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {franceTravail.length > 0 ? (
        <section className="stack" aria-labelledby="france-travail-access">
          <h2 id="france-travail-access">{t("admin.providerSecrets.apiAccess.title")}</h2>
          <p>{t("admin.providerSecrets.apiAccess.intro", { at: at.format(franceTravail[0]!.testedAt) })}</p>
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
                {franceTravail.map(({ api, state }) => (
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
      ) : null}
      {versions.length > 0 && cipher ? (
        <p>{t("admin.providerSecrets.keyVersions", { versions: versions.map((version) => `v${version}`).join(", "), active: `v${cipher.activeVersion}` })}</p>
      ) : null}

      {canSave ? (
        <div className="stack">
          {PROVIDER_SECRETS.map(({ name }) => (
            <details key={name} className="provider-secret-replace" open={named(search.key) === name}>
              <summary>{t("admin.providerSecrets.replaceLegend", { name })}</summary>
              {/* Write-only: the field is always empty, the value saved is never sent back. */}
              <form className="stack quota-form" action={replaceSecret}>
                <input type="hidden" name="name" value={name} />
                <fieldset>
                  <legend className="visually-hidden">{t("admin.providerSecrets.replaceLegend", { name })}</legend>
                  <div className="stack">
                    <label htmlFor={`value-${name}`}>{t("admin.providerSecrets.newValue", { name })}</label>
                    <input
                      id={`value-${name}`}
                      className="input"
                      name="value"
                      type="password"
                      required
                      autoComplete="new-password"
                      spellCheck={false}
                      aria-describedby={`value-${name}-help`}
                    />
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
          ))}
        </div>
      ) : null}
    </BackOfficeLayout>
  );
}
