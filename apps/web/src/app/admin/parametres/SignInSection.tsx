import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { TextInput, Textarea } from "@/design/Field";
import { Pill } from "@/design/Pill";
import { TestSignInButton } from "@/components/TestSignInButton";
import { isMultiTenant, PROVIDER_TYPES, SOCIAL_TYPES, type SignInProviderType } from "@/sign-in-providers/catalog";
import type { SaveError, SignInProviderStatus, SignInSecretSource } from "@/sign-in-providers/index";
import { linksByEmail } from "@/sign-in-providers/policy";
import { removeProvider, saveProvider, setRequireSso, startTestSignIn } from "./actions";
import { Here, type Ctx, type T } from "./context";
import { SIGN_IN_SWITCHES } from "./notices";

/** Microsoft's tenant for personal accounts, a new Microsoft provider's default. */
const DEFAULT_TENANT = "consumers";

/** A Sign-in Provider's save errors, as admin.signInProviders.errors names them. */
export const SIGN_IN_ERRORS = [
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


const TONE: Record<SignInSecretSource, "success" | "accent" | "danger"> = { database: "success", env: "accent", missing: "danger", unreadable: "danger" };

/**
 * The Connexion tab (#396, moved from the Connexion section): super-admins configure the Sign-in Providers (Google,
 * Apple, Microsoft, generic OIDC): which ones Candidates see, which ones Administrators may use, which ones link
 * accounts by email, and Require SSO for Administrators. Each provider shows the callback URL to paste in its
 * console, and is tested by a sign-in before it can be enabled. A secret is write-only: never sent back to the browser.
 */
export function SignInSection({
  ctx,
  providers,
  requireSsoForAdministrators,
  openForm,
  adding,
}: {
  ctx: Ctx;
  providers: readonly SignInProviderStatus[];
  requireSsoForAdministrators: boolean;
  /** The form to open: a provider's id, or `new-<type>`. */
  openForm?: string;
  adding: boolean;
}) {
  const { t } = ctx;
  const canWrite = ctx.can.signIn;
  const canSave = canWrite && ctx.canSaveSecrets;
  const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
  const at = ctx.at;
  const day = new Intl.DateTimeFormat(ctx.locale, { dateStyle: "long", timeZone: "Europe/Paris" });
  const settings = { requireSsoForAdministrators };
  const search = { form: openForm };
  const missingSocial = SOCIAL_TYPES.filter((type) => !providers.some((provider) => provider.type === type));
  const addable: SignInProviderType[] = [...missingSocial, "oidc"];

  return (
    <>
      {canWrite && !canSave ? (
        <Note tone="warn">
          <p>{t("admin.signInProviders.noMasterKey")}</p>
        </Note>
      ) : null}
      <section className="stack" aria-labelledby="require-sso-title">
        <h2 id="require-sso-title">{t("admin.signInProviders.ssoTitle")}</h2>
        <p>{t("admin.signInProviders.ssoHelp")}</p>
        {canWrite ? (
          <form className="stack" action={setRequireSso}>
            <Here ctx={ctx} />
            <div className="checkbox-field">
              <input id="require-sso" type="checkbox" name="requireSso" defaultChecked={settings.requireSsoForAdministrators} />
              <label htmlFor="require-sso">{t("admin.signInProviders.ssoLabel")}</label>
            </div>
            <button className={buttonClass()} type="submit">
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
              {provider.displayName} <Pill tone={provider.enabled ? "success" : "accent"}>{t(provider.enabled ? "admin.signInProviders.enabled" : "admin.signInProviders.disabled")}</Pill>
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
                  <Pill key={secret.field} tone={TONE[secret.source]}>
                    {t(`admin.signInProviders.fields.${secret.field}`)} : {t(`admin.signInProviders.sources.${secret.source}`)}
                  </Pill>
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
            {provider.type === "microsoft" && isMultiTenant(provider.tenantId ?? undefined) ? (
              <Note tone="warn">
                <p>{t("admin.signInProviders.multiTenantHelp")}</p>
              </Note>
            ) : null}
            {canWrite ? (
              <div className="provider-secret-actions">
                {provider.enabled ? null : <TestSignInButton providerId={provider.id} displayName={provider.displayName} start={startTestSignIn} />}
                <form action={removeProvider}>
                  <Here ctx={ctx} />
                  <input type="hidden" name="id" value={provider.id} />
                  <button className={buttonClass()} type="submit">
                    {t("admin.signInProviders.remove", { name: provider.displayName })}
                  </button>
                </form>
              </div>
            ) : null}
            {canSave ? (
              <details open={search.form === provider.id}>
                <summary>{t("admin.signInProviders.edit", { name: provider.displayName })}</summary>
                <ProviderForm ctx={ctx} type={provider.type} provider={provider} formKey={provider.id} />
              </details>
            ) : null}
          </article>
        ))}
      </section>

      {canSave && !adding ? (
        <section className="stack" aria-labelledby="add-title">
          <h2 id="add-title">{t("admin.signInProviders.addTitle")}</h2>
          {addable.map((type) => (
            <details key={type} open={search.form === `new-${type}`}>
              <summary>{t("admin.signInProviders.add", { type: t(`admin.signInProviders.types.${type}`) })}</summary>
              <ProviderForm ctx={ctx} type={type} formKey={`new-${type}`} />
            </details>
          ))}
        </section>
      ) : null}
    </>
  );
}


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
            <Pill tone="danger">{t("admin.signInProviders.appleFailed", { at: format.format(apple.failedAt) })}</Pill>
          </>
        ) : null}
      </dd>
    </>
  );
}

/** Adds a provider of `type`, or edits `provider`. Secret fields are always empty: left empty, a saved secret is kept. */
export function ProviderForm({ ctx, type, provider, formKey }: { ctx: Ctx; type: SignInProviderType; provider?: SignInProviderStatus; formKey: string }) {
  const { t } = ctx;
  const field = (name: string) => `${formKey}-${name}`;
  const secretHelp = provider ? t("admin.signInProviders.secretKeepHelp") : t("admin.signInProviders.secretHelp");
  return (
    <form className="stack quota-form" action={saveProvider}>
      <Here ctx={ctx} sheet="" />
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
              <TextInput id={field("id")} name="id" required pattern="[a-z][a-z0-9\-]{1,31}" spellCheck={false} aria-describedby={field("id-help")} />
              <p id={field("id-help")}>{t("admin.signInProviders.idHelp")}</p>
            </div>
          )
        ) : null}
        <div className="stack">
          <label htmlFor={field("displayName")}>{t("admin.signInProviders.displayName")}</label>
          <TextInput
            id={field("displayName")}
            name="displayName"
            required
            maxLength={60}
            defaultValue={provider?.displayName ?? (PROVIDER_TYPES[type].defaultName ? t(`admin.signInProviders.types.${type}`) : "")}
          />
        </div>
        <div className="stack">
          <label htmlFor={field("clientId")}>{t(type === "apple" ? "admin.signInProviders.serviceId" : "admin.signInProviders.clientId")}</label>
          <TextInput id={field("clientId")} name="clientId" required maxLength={512} spellCheck={false} defaultValue={provider?.clientId ?? ""} />
        </div>
        {PROVIDER_TYPES[type].setting === "discoveryUrl" ? (
          <div className="stack">
            <label htmlFor={field("discoveryUrl")}>{t("admin.signInProviders.discoveryUrl")}</label>
            <TextInput
              id={field("discoveryUrl")}
              name="discoveryUrl"
              type="url"
              required
              spellCheck={false}
              defaultValue={provider?.discoveryUrl ?? ""}
              aria-describedby={field("discoveryUrl-help")}
            />
            <p id={field("discoveryUrl-help")}>{t("admin.signInProviders.discoveryUrlHelp")}</p>
          </div>
        ) : null}
        {PROVIDER_TYPES[type].setting === "tenantId" ? (
          <div className="stack">
            <label htmlFor={field("tenantId")}>{t("admin.signInProviders.tenantId")}</label>
            <TextInput id={field("tenantId")} name="tenantId" spellCheck={false} defaultValue={provider?.tenantId ?? DEFAULT_TENANT} aria-describedby={field("tenantId-help")} />
            <p id={field("tenantId-help")}>{t("admin.signInProviders.tenantIdHelp")}</p>
          </div>
        ) : null}
        {PROVIDER_TYPES[type].setting === "appBundleIdentifier" ? (
          <div className="stack">
            <label htmlFor={field("appBundleIdentifier")}>{t("admin.signInProviders.appBundleIdentifier")}</label>
            <TextInput id={field("appBundleIdentifier")} name="appBundleIdentifier" spellCheck={false} defaultValue={provider?.appBundleIdentifier ?? ""} />
          </div>
        ) : null}
        {PROVIDER_TYPES[type].secretFields.map((secret) => (
          <div key={secret} className="stack">
            <label htmlFor={field(secret)}>{t(`admin.signInProviders.fields.${secret}`)}</label>
            {/* Write-only: the field is always empty, the value saved is never sent back. */}
            {secret === "privateKey" ? (
              <Textarea id={field(secret)} name={secret} rows={6} spellCheck={false} autoComplete="off" required={!provider} aria-describedby={field(`${secret}-help`)} />
            ) : (
              <TextInput
                id={field(secret)}
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
        <Switch name={SIGN_IN_SWITCHES.shownToCandidates} id={field(SIGN_IN_SWITCHES.shownToCandidates)} label={t("admin.signInProviders.shownToCandidatesLabel")} checked={provider?.shownToCandidates ?? true} />
        <Switch name={SIGN_IN_SWITCHES.allowedForAdministrators} id={field(SIGN_IN_SWITCHES.allowedForAdministrators)} label={t("admin.signInProviders.allowedForAdministratorsLabel")} checked={provider?.allowedForAdministrators ?? true} />
        {PROVIDER_TYPES[type].trustIsAChoice ? (
          <Switch
            name={SIGN_IN_SWITCHES.trustedForLinking}
            id={field(SIGN_IN_SWITCHES.trustedForLinking)}
            label={t("admin.signInProviders.trustedLabel")}
            help={t("admin.signInProviders.trustedHelp")}
            checked={provider?.trustedForLinking ?? false}
          />
        ) : null}
        <Switch
          name={SIGN_IN_SWITCHES.enabled}
          id={field(SIGN_IN_SWITCHES.enabled)}
          label={t("admin.signInProviders.enabledLabel")}
          help={t("admin.signInProviders.enabledHelp")}
          checked={provider?.enabled ?? false}
        />
        <button className={buttonClass({ variant: "primary" })} type="submit">
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
