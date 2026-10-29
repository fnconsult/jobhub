import { JOB_DISCOVERY_SOURCES, TOOLS, type JobDiscoverySource, type Tool } from "@jobhub/shared";
import { AddressDrawer } from "@/design/AddressDrawer";
import { buttonClass } from "@/design/button-class";
import { Select, TextInput } from "@/design/Field";
import { platformSetting } from "@/platform-settings/catalog";
import { ADD_TYPES, parametresHref, parametresTab, tabOfTool, type AddType } from "@/platform-settings/parametres";
import { PROVIDER_SECRET_NAMES } from "@/provider-secrets/catalog";
import { routes } from "@/routes";
import { SOCIAL_TYPES, type SignInProviderType } from "@/sign-in-providers/catalog";
import { openProviderSheet, replaceSecret, saveSetting, setJobDiscoverySource } from "./actions";
import { Here, type Ctx } from "./context";
import { FORM } from "./notices";
import { ProviderForm } from "./SignInSection";
import { AddJobDiscoverySiteForm, AddJobSiteForm } from "./SitesSections";

/** The model settings « + Ajouter » a model sets: each AI task's, and the identity route's. */
const MODEL_SETTINGS = ["AI_WEB_SEARCH_MODEL", "AI_IDENTITY_MODEL"];
const OIDC: SignInProviderType = "oidc";
const isModel = (name: string) => /^AI_.+_MODEL$/.test(name) && platformSetting(name) !== undefined;

/** The types `ctx`'s Administrator may add, in « + Ajouter »'s order: none for who only reads (Support). */
export function addableTypes(ctx: Ctx): AddType[] {
  const allowed: Record<AddType, boolean> = {
    provider: ctx.can.secrets,
    key: ctx.can.secrets && ctx.canSaveSecrets,
    model: ctx.can.settings,
    source: ctx.can.sites,
    job_discovery_site: ctx.can.sites,
    job_site: ctx.can.sites,
    sign_in_provider: ctx.can.signIn && ctx.canSaveSecrets,
  };
  return ADD_TYPES.filter((type) => allowed[type]);
}

/**
 * « + Ajouter » (#396), in the Drawer (#465), opened from the address (`&ajouter=`): one type select (provider, key, model, source, Job discovery site, Job Site,
 * Sign-in Provider), preselected from the tab, then the form for that type. Each form comes back to the tab that
 * shows what it added.
 */
export function AddPanel({ ctx, type, allowed, sources, signInTypes }: { ctx: Ctx; type: AddType; allowed: readonly AddType[]; sources: Record<JobDiscoverySource, boolean>; signInTypes: readonly SignInProviderType[] }) {
  const { t } = ctx;
  /** `ctx` on the tab that shows what a form adds: its action comes back there. */
  const on = (slug: string): Ctx => ({ ...ctx, tab: parametresTab(slug), sheet: undefined });
  const withKeys = (TOOLS as readonly Tool[]).filter((tool) => tabOfTool(tool) && tool.keys.some((key) => (PROVIDER_SECRET_NAMES as readonly string[]).includes(key)));
  const models = [...new Set([...ctx.tab.settings, ...MODEL_SETTINGS, ...(parametresTab("ia").settings as string[])])].filter(isModel);
  const disabledSources = JOB_DISCOVERY_SOURCES.filter((source) => !sources[source]);
  const missingSocial = SOCIAL_TYPES.filter((social) => !signInTypes.includes(social));
  const onAi = on("ia");
  const onSources = on("sources");
  const onWebSearch = on("recherche-web");
  const onExtension = on("extension");
  const onSignIn = on("connexion");

  return (
    <AddressDrawer title={t("admin.platformSettings.add.title")} closeHref={parametresHref(ctx.tab.id)} opener="[data-opens-add]" data-add-panel={type}>
      <form className="stack" method="get" action={routes.adminPlatformSettings}>
        <input type="hidden" name={FORM.tab} value={ctx.tab.slug} />
        <label htmlFor="add-type">{t("admin.platformSettings.add.type")}</label>
        <Select id="add-type" name="ajouter" defaultValue={type}>
          {allowed.map((choice) => (
            <option key={choice} value={choice}>
              {t(`admin.platformSettings.add.types.${choice}`)}
            </option>
          ))}
        </Select>
        <button className={buttonClass()} type="submit">
          {t("admin.platformSettings.add.choose")}
        </button>
      </form>

      <section className="stack" aria-labelledby="add-form-title">
        <h3 id="add-form-title">{t(`admin.platformSettings.add.types.${type}`)}</h3>
        {type === "provider" ? (
          <form className="stack" action={openProviderSheet}>
            <Here ctx={ctx} sheet="" />
            <label htmlFor="add-provider">{t("admin.platformSettings.add.providerLabel")}</label>
            <Select id="add-provider" name="provider" aria-describedby="add-provider-help" defaultValue={withKeys.find((tool) => tabOfTool(tool)?.id === ctx.tab.id)?.id}>
              {withKeys.map((tool) => (
                <option key={tool.id} value={tool.id}>
                  {tool.name}
                </option>
              ))}
            </Select>
            <p id="add-provider-help">{t("admin.platformSettings.add.providerHelp")}</p>
            <button className={buttonClass({ variant: "primary" })} type="submit">
              {t("admin.platformSettings.add.openSheet")}
            </button>
          </form>
        ) : null}
        {type === "key" ? (
          // Write-only: the field is always empty, the value saved is never sent back.
          <form className="stack quota-form" action={replaceSecret}>
            <Here ctx={ctx} sheet="" />
            <label htmlFor="add-key">{t("admin.platformSettings.add.keyLabel")}</label>
            <Select id="add-key" name="name">
              {PROVIDER_SECRET_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <label htmlFor="add-key-value">{t("admin.platformSettings.add.keyValue")}</label>
            <TextInput id="add-key-value" name="value" type="password" required autoComplete="new-password" spellCheck={false} aria-describedby="add-key-value-help" />
            <p id="add-key-value-help">{t("admin.providerSecrets.newValueHelp")}</p>
            <div className="checkbox-field">
              <input id="add-key-anyway" type="checkbox" name="saveAnyway" aria-describedby="add-key-anyway-help" />
              <label htmlFor="add-key-anyway">{t("admin.providerSecrets.saveAnyway")}</label>
              <p id="add-key-anyway-help">{t("admin.providerSecrets.saveAnywayHelp")}</p>
            </div>
            <button className={buttonClass({ variant: "primary" })} type="submit">
              {t("admin.platformSettings.save")}
            </button>
          </form>
        ) : null}
        {type === "model" ? (
          <form className="stack" action={saveSetting}>
            <Here ctx={onAi} />
            <label htmlFor="add-model-setting">{t("admin.platformSettings.add.modelSetting")}</label>
            <Select id="add-model-setting" name="name">
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <label htmlFor="add-model-value">{t("admin.platformSettings.add.modelValue")}</label>
            <TextInput id="add-model-value" name="value" required aria-describedby="add-model-help" />
            <p id="add-model-help">{t("admin.platformSettings.rules.model", { provider: "" })}</p>
            <button className={buttonClass({ variant: "primary" })} type="submit">
              {t("admin.platformSettings.save")}
            </button>
          </form>
        ) : null}
        {type === "source" ? (
          disabledSources.length === 0 ? (
            <p>{t("admin.platformSettings.add.noSource")}</p>
          ) : (
            <form className="stack" action={setJobDiscoverySource}>
              <Here ctx={onSources} />
              <input type="hidden" name="enabled" value={String(true)} />
              <label htmlFor="add-source">{t("admin.platformSettings.add.sourceLabel")}</label>
              <Select id="add-source" name="source">
                {disabledSources.map((source) => (
                  <option key={source} value={source}>
                    {t(`admin.searchSites.sources.names.${source}`)}
                  </option>
                ))}
              </Select>
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("admin.platformSettings.add.enableSource")}
              </button>
            </form>
          )
        ) : null}
        {type === "job_discovery_site" ? <AddJobDiscoverySiteForm ctx={onWebSearch} legend={false} /> : null}
        {type === "job_site" ? <AddJobSiteForm ctx={onExtension} legend={false} /> : null}
        {type === "sign_in_provider"
          ? [...missingSocial, OIDC].map((signIn) => (
              <details key={signIn}>
                <summary>{t("admin.signInProviders.add", { type: t(`admin.signInProviders.types.${signIn}`) })}</summary>
                <ProviderForm ctx={onSignIn} type={signIn} formKey={`new-${signIn}`} />
              </details>
            ))
          : null}
      </section>
    </AddressDrawer>
  );
}
