import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { TestSignInButton } from "@/components/TestSignInButton";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { secretCipherFromEnv } from "@/provider-secrets/cipher";
import { routes } from "@/routes";
import { isMultiTenant, PROVIDER_TYPES, SOCIAL_TYPES, type SignInProviderType } from "@/sign-in-providers/catalog";
import type { SaveError, SignInProviderStatus, SignInSecretSource } from "@/sign-in-providers/index";
import { applyLatestSignIn } from "@/auth/server";
import { linksByEmail } from "@/sign-in-providers/policy";
import { getSignInProviders } from "@/sign-in-providers/server";

const ERRORS = [
  "invalid_type",
  "invalid_id",
  "invalid_display_name",
  "invalid_client_id",
  "invalid_discovery_url",
  "invalid_tenant",
  "invalid_bundle_id",
  "missing_secret",
  "too_long",
  "invalid_apple_key",
  "no_master_key",
  "not_tested",
  "unknown_provider",
] as const satisfies readonly (SaveError | "unknown_provider")[];
type ErrorCode = (typeof ERRORS)[number];

/** The provider form's switches: the form fields saveProvider reads. */
const SWITCHES = { shownToCandidates: "shownToCandidates", allowedForAdministrators: "allowedForAdministrators", trustedForLinking: "trustedForLinking", enabled: "enabled" } as const;

const TONE: Record<SignInSecretSource, "success" | "accent" | "danger"> = { database: "success", env: "accent", missing: "danger", unreadable: "danger" };

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("ssoProviders");
  const t = await getServerT();
  return { title: `${t("admin.signInProviders.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** Where the page goes after a change: what happened, by provider id and code only. Never a secret. */
const back = (params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return `${routes.adminSignInProviders}?${query}`;
};

const text = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
};

async function saveProvider(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const type = text(form, "type");
  const saved = await getSignInProviders().save(administrator, {
    type,
    id: text(form, "id"),
    displayName: text(form, "displayName"),
    clientId: text(form, "clientId"),
    discoveryUrl: text(form, "discoveryUrl"),
    tenantId: text(form, "tenantId"),
    appBundleIdentifier: text(form, "appBundleIdentifier"),
    enabled: form.get(SWITCHES.enabled) === "on",
    shownToCandidates: form.get(SWITCHES.shownToCandidates) === "on",
    allowedForAdministrators: form.get(SWITCHES.allowedForAdministrators) === "on",
    trustedForLinking: form.get(SWITCHES.trustedForLinking) === "on",
    secrets: { clientSecret: text(form, "clientSecret"), teamId: text(form, "teamId"), keyId: text(form, "keyId"), privateKey: text(form, "privateKey") },
  });
  if (!saved.ok) redirect(back({ error: saved.error, form: text(form, "formKey") }));
  // This process uses it at once; the others hear the NOTIFY.
  await applyLatestSignIn();
  redirect(back({ saved: saved.id }));
}

async function removeProvider(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const removed = await getSignInProviders().remove(administrator, form.get("id"));
  if (!removed.ok) redirect(back({ error: removed.error }));
  await applyLatestSignIn();
  redirect(back({ removed: "1" }));
}

async function setRequireSso(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  await getSignInProviders().setRequireSsoForAdministrators(administrator, form.get("requireSso") === "on");
  await applyLatestSignIn();
  redirect(back({ sso: "saved" }));
}

/**
 * Starts a test sign-in through a provider not enabled: registers it for a few minutes and
 * returns the nonce its callback must bring back, so only this super-admin's sign-in can pass it.
 */
async function startTestSignIn(providerId: string): Promise<{ nonce: string } | { error: string }> {
  "use server";
  const { administrator } = await requireBackOffice("ssoProviders", "write");
  const started = await getSignInProviders().startTestSignIn(administrator, providerId);
  if (!started.ok) return { error: started.error };
  await applyLatestSignIn();
  return { nonce: started.nonce };
}

type Search = { saved?: string; removed?: string; tested?: string; testFailed?: string; error?: string; form?: string; sso?: string };

/**
 * Super-admins configure the Sign-in Providers (Google, Apple, Microsoft, generic OIDC):
 * which ones Candidates see, which ones Administrators may use, which ones link accounts
 * by email, and Require SSO for Administrators. Each provider shows the callback URL to
 * paste in its console, and is tested by a sign-in before it can be enabled. A secret is
 * write-only: never sent back to the browser.
 */
export default async function SignInProvidersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { access, canWrite } = await requireBackOffice("ssoProviders");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const search = await searchParams;
  const [providers, settings] = await Promise.all([getSignInProviders().list(), getSignInProviders().settings()]);
  const canSave = canWrite && secretCipherFromEnv(process.env) !== null;
  const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });
  // Only provider ids and codes from the address bar are shown, each checked against the known ones.
  const named = (id: string | undefined) => providers.find((provider) => provider.id === id);
  const error = ERRORS.includes(search.error as ErrorCode) ? (search.error as ErrorCode) : undefined;

  const notices: { role: "status" | "alert"; text: string }[] = [];
  const saved = named(search.saved);
  if (saved) notices.push({ role: "status", text: t("admin.signInProviders.saved", { name: saved.displayName }) });
  if (search.removed) notices.push({ role: "status", text: t("admin.signInProviders.removed") });
  if (search.sso === "saved") notices.push({ role: "status", text: t(settings.requireSsoForAdministrators ? "admin.signInProviders.ssoOn" : "admin.signInProviders.ssoOff") });
  const tested = named(search.tested);
  if (tested) notices.push({ role: "status", text: t("admin.signInProviders.testPassed", { name: tested.displayName }) });
  const testFailed = named(search.testFailed);
  if (testFailed) notices.push({ role: "alert", text: t("admin.signInProviders.testFailed", { name: testFailed.displayName }) });
  else if (error) notices.push({ role: "alert", text: t(`admin.signInProviders.errors.${error}`) });

  const missingSocial = SOCIAL_TYPES.filter((type) => !providers.some((provider) => provider.type === type));
  const addable: SignInProviderType[] = [...missingSocial, "oidc"];

  return (
    <BackOfficeLayout access={access}>
      <h1>{t("admin.signInProviders.title")}</h1>
      <p className="lead">{t("admin.signInProviders.intro")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {canWrite && !canSave ? <p className="notice">{t("admin.signInProviders.noMasterKey")}</p> : null}
      {notices.map((notice) => (
        <p key={notice.text} className="notice" role={notice.role}>
          {notice.text}
        </p>
      ))}

      <section className="stack" aria-labelledby="require-sso-title">
        <h2 id="require-sso-title">{t("admin.signInProviders.ssoTitle")}</h2>
        <p>{t("admin.signInProviders.ssoHelp")}</p>
        {canWrite ? (
          <form className="stack" action={setRequireSso}>
            <div className="checkbox-field">
              <input id="require-sso" type="checkbox" name="requireSso" defaultChecked={settings.requireSsoForAdministrators} />
              <label htmlFor="require-sso">{t("admin.signInProviders.ssoLabel")}</label>
            </div>
            <button className="button" type="submit">
              {t("admin.signInProviders.ssoSave")}
            </button>
          </form>
        ) : (
          <p>{t(settings.requireSsoForAdministrators ? "admin.signInProviders.ssoOn" : "admin.signInProviders.ssoOff")}</p>
        )}
      </section>

      <section className="stack" aria-labelledby="providers-title">
        <h2 id="providers-title">{t("admin.signInProviders.listTitle")}</h2>
        {providers.length === 0 ? <p>{t("admin.signInProviders.none")}</p> : null}
        {providers.map((provider) => (
          <article key={provider.id} className="stack sign-in-provider" aria-labelledby={`provider-${provider.id}`}>
            <h3 id={`provider-${provider.id}`}>
              {provider.displayName}{" "}
              <span className="pill" data-tone={provider.enabled ? "success" : "accent"}>
                {t(provider.enabled ? "admin.signInProviders.enabled" : "admin.signInProviders.disabled")}
              </span>
            </h3>
            <dl>
              <dt>{t("admin.signInProviders.type")}</dt>
              <dd>
                {t(`admin.signInProviders.types.${provider.type}`)} (<code>{provider.id}</code>)
              </dd>
              <dt>{t("admin.signInProviders.callbackUrl")}</dt>
              <dd>
                <code className="wrap-anywhere">{`${origin}${provider.callbackPath}`}</code>
                <br />
                {t("admin.signInProviders.callbackHelp")}
              </dd>
              <dt>{t("admin.signInProviders.audience")}</dt>
              <dd>
                {[
                  provider.shownToCandidates ? t("admin.signInProviders.shownToCandidates") : t("admin.signInProviders.hiddenFromCandidates"),
                  provider.allowedForAdministrators ? t("admin.signInProviders.allowedForAdministrators") : t("admin.signInProviders.notForAdministrators"),
                  linksByEmail(provider)
                    ? t("admin.signInProviders.trusted")
                    : t("admin.signInProviders.untrusted"),
                ].join(" · ")}
              </dd>
              <dt>{t("admin.signInProviders.secrets")}</dt>
              <dd>
                {provider.secrets.map((secret) => (
                  <span key={secret.field} className="pill" data-tone={TONE[secret.source]}>
                    {t(`admin.signInProviders.fields.${secret.field}`)} : {t(`admin.signInProviders.sources.${secret.source}`)}
                  </span>
                ))}
              </dd>
              {provider.apple ? <AppleDates apple={provider.apple} format={day} t={t} /> : null}
              <dt>{t("admin.signInProviders.testLabel")}</dt>
              <dd>
                {provider.testedAt ? (
                  <time dateTime={provider.testedAt.toISOString()}>{t("admin.signInProviders.testedAt", { at: at.format(provider.testedAt) })}</time>
                ) : (
                  t("admin.signInProviders.notTested")
                )}
              </dd>
              <dt>{t("admin.signInProviders.changed")}</dt>
              <dd>
                {provider.updatedBy ?? t("admin.signInProviders.fromEnv")}, <time dateTime={provider.updatedAt.toISOString()}>{at.format(provider.updatedAt)}</time>
              </dd>
            </dl>
            {provider.type === "microsoft" && isMultiTenant(provider.tenantId ?? undefined) ? <p className="notice">{t("admin.signInProviders.multiTenantHelp")}</p> : null}
            {canWrite ? (
              <div className="provider-secret-actions">
                {provider.enabled ? null : <TestSignInButton providerId={provider.id} displayName={provider.displayName} start={startTestSignIn} />}
                <form action={removeProvider}>
                  <input type="hidden" name="id" value={provider.id} />
                  <button className="button" type="submit">
                    {t("admin.signInProviders.remove", { name: provider.displayName })}
                  </button>
                </form>
              </div>
            ) : null}
            {canSave ? (
              <details open={search.form === provider.id}>
                <summary>{t("admin.signInProviders.edit", { name: provider.displayName })}</summary>
                <ProviderForm type={provider.type} provider={provider} formKey={provider.id} t={t} />
              </details>
            ) : null}
          </article>
        ))}
      </section>

      {canSave ? (
        <section className="stack" aria-labelledby="add-title">
          <h2 id="add-title">{t("admin.signInProviders.addTitle")}</h2>
          {addable.map((type) => (
            <details key={type} open={search.form === `new-${type}`}>
              <summary>{t("admin.signInProviders.add", { type: t(`admin.signInProviders.types.${type}`) })}</summary>
              <ProviderForm type={type} formKey={`new-${type}`} t={t} />
            </details>
          ))}
        </section>
      ) : null}
    </BackOfficeLayout>
  );
}

type T = Awaited<ReturnType<typeof getServerT>>;

function AppleDates({ apple, format, t }: { apple: NonNullable<SignInProviderStatus["apple"]>; format: Intl.DateTimeFormat; t: T }) {
  return (
    <>
      <dt>{t("admin.signInProviders.appleSecret")}</dt>
      <dd>
        {apple.generatedAt && apple.expiresAt && apple.nextRegenerationAt
          ? t("admin.signInProviders.appleDates", { generated: format.format(apple.generatedAt), expires: format.format(apple.expiresAt), next: format.format(apple.nextRegenerationAt) })
          : t("admin.signInProviders.appleNotGenerated")}
        {apple.failedAt ? (
          <>
            <br />
            <span className="pill" data-tone="danger">
              {t("admin.signInProviders.appleFailed", { at: format.format(apple.failedAt) })}
            </span>
          </>
        ) : null}
      </dd>
    </>
  );
}

/** Adds a provider of `type`, or edits `provider`. Secret fields are always empty: left empty, a saved secret is kept. */
function ProviderForm({ type, provider, formKey, t }: { type: SignInProviderType; provider?: SignInProviderStatus; formKey: string; t: T }) {
  const field = (name: string) => `${formKey}-${name}`;
  const secretHelp = provider ? t("admin.signInProviders.secretKeepHelp") : t("admin.signInProviders.secretHelp");
  return (
    <form className="stack quota-form" action={saveProvider}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="formKey" value={formKey} />
      <fieldset className="stack">
        <legend className="visually-hidden">{provider ? t("admin.signInProviders.edit", { name: provider.displayName }) : t("admin.signInProviders.add", { type: t(`admin.signInProviders.types.${type}`) })}</legend>
        {PROVIDER_TYPES[type].idIsChosen ? (
          provider ? (
            <input type="hidden" name="id" value={provider.id} />
          ) : (
            <div className="stack">
              <label htmlFor={field("id")}>{t("admin.signInProviders.id")}</label>
              <input id={field("id")} className="input" name="id" required pattern="[a-z][a-z0-9\-]{1,31}" spellCheck={false} aria-describedby={field("id-help")} />
              <p id={field("id-help")}>{t("admin.signInProviders.idHelp")}</p>
            </div>
          )
        ) : null}
        <div className="stack">
          <label htmlFor={field("displayName")}>{t("admin.signInProviders.displayName")}</label>
          <input id={field("displayName")} className="input" name="displayName" required maxLength={60} defaultValue={provider?.displayName ?? (PROVIDER_TYPES[type].defaultName ? t(`admin.signInProviders.types.${type}`) : "")} />
        </div>
        <div className="stack">
          <label htmlFor={field("clientId")}>{t(type === "apple" ? "admin.signInProviders.serviceId" : "admin.signInProviders.clientId")}</label>
          <input id={field("clientId")} className="input" name="clientId" required maxLength={512} spellCheck={false} defaultValue={provider?.clientId ?? ""} />
        </div>
        {PROVIDER_TYPES[type].setting === "discoveryUrl" ? (
          <div className="stack">
            <label htmlFor={field("discoveryUrl")}>{t("admin.signInProviders.discoveryUrl")}</label>
            <input id={field("discoveryUrl")} className="input" name="discoveryUrl" type="url" required spellCheck={false} defaultValue={provider?.discoveryUrl ?? ""} aria-describedby={field("discoveryUrl-help")} />
            <p id={field("discoveryUrl-help")}>{t("admin.signInProviders.discoveryUrlHelp")}</p>
          </div>
        ) : null}
        {PROVIDER_TYPES[type].setting === "tenantId" ? (
          <div className="stack">
            <label htmlFor={field("tenantId")}>{t("admin.signInProviders.tenantId")}</label>
            <input id={field("tenantId")} className="input" name="tenantId" spellCheck={false} defaultValue={provider?.tenantId ?? "consumers"} aria-describedby={field("tenantId-help")} />
            <p id={field("tenantId-help")}>{t("admin.signInProviders.tenantIdHelp")}</p>
          </div>
        ) : null}
        {PROVIDER_TYPES[type].setting === "appBundleIdentifier" ? (
          <div className="stack">
            <label htmlFor={field("appBundleIdentifier")}>{t("admin.signInProviders.appBundleIdentifier")}</label>
            <input id={field("appBundleIdentifier")} className="input" name="appBundleIdentifier" spellCheck={false} defaultValue={provider?.appBundleIdentifier ?? ""} />
          </div>
        ) : null}
        {PROVIDER_TYPES[type].secretFields.map((secret) => (
          <div key={secret} className="stack">
            <label htmlFor={field(secret)}>{t(`admin.signInProviders.fields.${secret}`)}</label>
            {/* Write-only: the field is always empty, the value saved is never sent back. */}
            {secret === "privateKey" ? (
              <textarea id={field(secret)} className="input" name={secret} rows={6} spellCheck={false} autoComplete="off" required={!provider} aria-describedby={field(`${secret}-help`)} />
            ) : (
              <input
                id={field(secret)}
                className="input"
                name={secret}
                type={secret === "clientSecret" ? "password" : "text"}
                autoComplete="new-password"
                spellCheck={false}
                required={!provider}
                aria-describedby={field(`${secret}-help`)}
              />
            )}
            <p id={field(`${secret}-help`)}>{secretHelp}</p>
          </div>
        ))}
        <Switch name={SWITCHES.shownToCandidates} id={field(SWITCHES.shownToCandidates)} label={t("admin.signInProviders.shownToCandidatesLabel")} checked={provider?.shownToCandidates ?? true} />
        <Switch name={SWITCHES.allowedForAdministrators} id={field(SWITCHES.allowedForAdministrators)} label={t("admin.signInProviders.allowedForAdministratorsLabel")} checked={provider?.allowedForAdministrators ?? true} />
        {PROVIDER_TYPES[type].trustIsAChoice ? (
          <Switch
            name={SWITCHES.trustedForLinking}
            id={field(SWITCHES.trustedForLinking)}
            label={t("admin.signInProviders.trustedLabel")}
            help={t("admin.signInProviders.trustedHelp")}
            checked={provider?.trustedForLinking ?? false}
          />
        ) : null}
        <Switch name={SWITCHES.enabled} id={field(SWITCHES.enabled)} label={t("admin.signInProviders.enabledLabel")} help={t("admin.signInProviders.enabledHelp")} checked={provider?.enabled ?? false} />
        <button className="button button-primary" type="submit">
          {t("admin.signInProviders.save")}
        </button>
      </fieldset>
    </form>
  );
}

function Switch({ name, id, label, help, checked }: { name: string; id: string; label: string; help?: string; checked: boolean }) {
  return (
    <div className="checkbox-field">
      <input id={id} type="checkbox" name={name} defaultChecked={checked} aria-describedby={help ? `${id}-help` : undefined} />
      <label htmlFor={id}>{label}</label>
      {help ? <p id={`${id}-help`}>{help}</p> : null}
    </div>
  );
}
