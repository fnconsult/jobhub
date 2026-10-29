import { buttonClass } from "@/design/button-class";
import { TextInput } from "@/design/Field";
import { FORBIDDEN_SITES, type JobDiscoverySite } from "@jobhub/shared";
import type { JobSite } from "@/search-sites/index";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { addJobDiscoverySite, addJobSite, removeJobDiscoverySite, removeJobSite, setJobDiscoverySite, setJobSite } from "./actions";
import { Table } from "@/design/Table";
import { Here, type Ctx } from "./context";

/** The form field naming the row an action is for. */
const FIELDS = { domain: "domain", pattern: "pattern" } as const;

/** A button switching one row on or off; disabled, with nothing to send, for roles that may only read. */
function Toggle({ ctx, action, name, value, enabled, label }: { ctx: Ctx; action: (form: FormData) => Promise<void>; name: string; value: string; enabled: boolean; label: string }) {
  return (
    <BackOfficeForm canWrite={ctx.can.sites} action={action}>
      <Here ctx={ctx} />
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button className={buttonClass()} type="submit" disabled={!ctx.can.sites}>
        {ctx.t(enabled ? "admin.searchSites.disable" : "admin.searchSites.enable", { name: label })}
      </button>
    </BackOfficeForm>
  );
}

function Remove({ ctx, action, name, value }: { ctx: Ctx; action: (form: FormData) => Promise<void>; name: string; value: string }) {
  return (
    <BackOfficeForm canWrite={ctx.can.sites} action={action}>
      <Here ctx={ctx} />
      <input type="hidden" name={name} value={value} />
      <button className={buttonClass()} type="submit" disabled={!ctx.can.sites}>
        {ctx.t("admin.searchSites.remove", { name: value })}
      </button>
    </BackOfficeForm>
  );
}

const status = (ctx: Ctx, enabled: boolean) => ctx.t(enabled ? "admin.searchSites.enabled" : "admin.searchSites.disabled");

/** The form adding a Job discovery site: on the Recherche web tab, and in « + Ajouter ». */
export function AddJobDiscoverySiteForm({ ctx, legend = true }: { ctx: Ctx; legend?: boolean }) {
  const { t } = ctx;
  return (
    <BackOfficeForm canWrite={ctx.can.sites} className="stack quota-form" action={addJobDiscoverySite}>
      <Here ctx={ctx} sheet="" />
      {/* Read-only for roles that may not change the search sites: the fields show, disabled, with nothing to send. */}
      <fieldset disabled={!ctx.can.sites}>
        <legend className={legend ? undefined : "visually-hidden"}>
          <h3>{t("admin.searchSites.discoverySites.addTitle")}</h3>
        </legend>
        <div className="stack">
          <label htmlFor="discovery-site-domain">{t("admin.searchSites.discoverySites.domain")}</label>
          <TextInput id="discovery-site-domain" name="domain" required autoComplete="off" aria-describedby="discovery-site-domain-help" />
          <p id="discovery-site-domain-help">{t("admin.searchSites.discoverySites.domainHelp")}</p>
        </div>
        <button className={buttonClass({ variant: "primary" })} type="submit">
          {t("admin.searchSites.discoverySites.add")}
        </button>
      </fieldset>
    </BackOfficeForm>
  );
}

/** The form adding a Job Site: on the Extension tab, and in « + Ajouter ». */
export function AddJobSiteForm({ ctx, legend = true }: { ctx: Ctx; legend?: boolean }) {
  const { t } = ctx;
  return (
    <BackOfficeForm canWrite={ctx.can.sites} className="stack quota-form" action={addJobSite}>
      <Here ctx={ctx} sheet="" />
      <fieldset disabled={!ctx.can.sites}>
        <legend className={legend ? undefined : "visually-hidden"}>
          <h3>{t("admin.searchSites.jobSites.addTitle")}</h3>
        </legend>
        <div className="stack">
          <label htmlFor="job-site-pattern">{t("admin.searchSites.jobSites.pattern")}</label>
          <TextInput id="job-site-pattern" name="pattern" required autoComplete="off" aria-describedby="job-site-pattern-help" />
          <p id="job-site-pattern-help">{t("admin.searchSites.jobSites.patternHelp")}</p>
        </div>
        <div className="stack">
          <label htmlFor="job-site-posting-pages">{t("admin.searchSites.jobSites.postingPagesOptional")}</label>
          <TextInput id="job-site-posting-pages" name="postingPages" autoComplete="off" aria-describedby="job-site-posting-pages-help" />
          <p id="job-site-posting-pages-help">{t("admin.searchSites.jobSites.postingPagesHelp")}</p>
        </div>
        <button className={buttonClass({ variant: "primary" })} type="submit">
          {t("admin.searchSites.jobSites.add")}
        </button>
      </fieldset>
    </BackOfficeForm>
  );
}

/** The Job discovery sites (moved from Sites de recherche to the Recherche web tab, #396): searched on purpose while enabled, skipped while disabled. */
export function DiscoverySitesSection({ ctx, sites, adding }: { ctx: Ctx; sites: readonly JobDiscoverySite[]; adding: boolean }) {
  const { t } = ctx;
  return (
    <section className="stack" aria-labelledby="discovery-sites-title">
      <h2 id="discovery-sites-title">{t("admin.searchSites.discoverySites.title")}</h2>
      <p>{t("admin.searchSites.discoverySites.intro")}</p>
      <p>{t("admin.searchSites.discoverySites.forbidden", { sites: FORBIDDEN_SITES.join(", ") })}</p>
      {sites.length === 0 ? (
        <p>{t("admin.searchSites.discoverySites.none")}</p>
      ) : (
        <Table
          label={t("admin.searchSites.discoverySites.caption")}
          columns={[
            { header: t("admin.searchSites.discoverySites.domain"), rowHeader: true, cell: (site) => site.domain },
            { header: t("admin.searchSites.status"), cell: (site) => status(ctx, site.enabled) },
            {
              header: t("admin.searchSites.actions"),
              cell: (site) => (
                <div className="stack">
                  <Toggle ctx={ctx} action={setJobDiscoverySite} name={FIELDS.domain} value={site.domain} enabled={site.enabled} label={site.domain} />
                  <Remove ctx={ctx} action={removeJobDiscoverySite} name={FIELDS.domain} value={site.domain} />
                </div>
              ),
            },
          ]}
          rows={sites}
          rowKey={(site) => site.domain}
        />
      )}
      {/* While « + Ajouter » shows the same form, it is not drawn twice: its fields keep one id. */}
      {adding ? null : <AddJobDiscoverySiteForm ctx={ctx} />}
    </section>
  );
}

/** The extension's Job Sites (moved from Sites de recherche to the Extension tab, #396). */
export function JobSitesSection({ ctx, sites, adding }: { ctx: Ctx; sites: readonly JobSite[]; adding: boolean }) {
  const { t } = ctx;
  return (
    <section className="stack" aria-labelledby="job-sites-title">
      <h2 id="job-sites-title">{t("admin.searchSites.jobSites.title")}</h2>
      <p>{t("admin.searchSites.jobSites.intro")}</p>
      <Table
        label={t("admin.searchSites.jobSites.caption")}
        columns={[
          { header: t("admin.searchSites.jobSites.pattern"), rowHeader: true, cell: (site) => <code>{site.pattern}</code> },
          { header: t("admin.searchSites.jobSites.postingPages"), cell: (site) => (site.postingPages ? <code>{site.postingPages}</code> : t("admin.searchSites.jobSites.anyPostingPage")) },
          { header: t("admin.searchSites.jobSites.origin"), cell: (site) => t(site.builtIn ? "admin.searchSites.jobSites.builtIn" : "admin.searchSites.jobSites.added") },
          { header: t("admin.searchSites.status"), cell: (site) => status(ctx, site.enabled) },
          {
            header: t("admin.searchSites.actions"),
            cell: (site) => (
              <div className="stack">
                <Toggle ctx={ctx} action={setJobSite} name={FIELDS.pattern} value={site.pattern} enabled={site.enabled} label={site.pattern} />
                {site.builtIn ? null : <Remove ctx={ctx} action={removeJobSite} name={FIELDS.pattern} value={site.pattern} />}
              </div>
            ),
          },
        ]}
        rows={sites}
        rowKey={(site) => site.pattern}
      />
      {adding ? null : <AddJobSiteForm ctx={ctx} />}
    </section>
  );
}
