import { FORBIDDEN_SITES, JOB_DISCOVERY_SOURCES } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdministrator } from "@/admin/server";
import { BackOfficeHeader } from "@/components/BackOfficeHeader";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { getSearchSites } from "@/search-sites/server";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireAdministrator();
  const t = await getServerT();
  return { title: `${t("admin.searchSites.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** What the page says after an action: a key under admin.searchSites.notices, and whether it is an error. */
const NOTICES = {
  saved: false,
  jobSiteAdded: false,
  jobSiteRemoved: false,
  jobSiteInvalid: true,
  jobSiteExists: true,
  jobSiteBuiltIn: true,
  siteAdded: false,
  siteRemoved: false,
  siteInvalid: true,
  siteExists: true,
  siteForbidden: true,
  notFound: true,
} as const;
type Notice = keyof typeof NOTICES;

/** The form field naming the row an action is for. */
const FIELDS = { source: "source", domain: "domain", pattern: "pattern" } as const;

const back = (notice: Notice): never => redirect(`${routes.adminSearchSites}?notice=${notice}`);
const enabledIn = (form: FormData) => form.get("enabled") === "true";

async function setJobDiscoverySource(form: FormData) {
  "use server";
  await requireAdministrator();
  const known = await getSearchSites().setJobDiscoverySourceEnabled(String(form.get("source")), enabledIn(form));
  back(known ? "saved" : "notFound");
}

async function addJobDiscoverySite(form: FormData) {
  "use server";
  await requireAdministrator();
  const added = await getSearchSites().addJobDiscoverySite(form.get("domain"));
  if (added.ok) back("siteAdded");
  else back(added.error === "forbidden" ? "siteForbidden" : added.error === "exists" ? "siteExists" : "siteInvalid");
}

async function setJobDiscoverySite(form: FormData) {
  "use server";
  await requireAdministrator();
  const result = await getSearchSites().setJobDiscoverySiteEnabled(String(form.get("domain")), enabledIn(form));
  back(result.ok ? "saved" : result.error === "forbidden" ? "siteForbidden" : "notFound");
}

async function removeJobDiscoverySite(form: FormData) {
  "use server";
  await requireAdministrator();
  back((await getSearchSites().removeJobDiscoverySite(String(form.get("domain")))) ? "siteRemoved" : "notFound");
}

async function addJobSite(form: FormData) {
  "use server";
  await requireAdministrator();
  const added = await getSearchSites().addJobSite({ pattern: form.get("pattern"), postingPages: form.get("postingPages") });
  if (added.ok) back("jobSiteAdded");
  else back(added.error === "exists" ? "jobSiteExists" : "jobSiteInvalid");
}

async function setJobSite(form: FormData) {
  "use server";
  await requireAdministrator();
  back((await getSearchSites().setJobSiteEnabled(String(form.get("pattern")), enabledIn(form))) ? "saved" : "notFound");
}

async function removeJobSite(form: FormData) {
  "use server";
  await requireAdministrator();
  const removed = await getSearchSites().removeJobSite(String(form.get("pattern")));
  back(removed === "removed" ? "jobSiteRemoved" : removed === "built_in" ? "jobSiteBuiltIn" : "notFound");
}

/** Administrators choose the sites Jobbbox searches: Job discovery sources and sites, and the extension's Job Sites. */
export default async function SearchSitesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireAdministrator();
  const t = await getServerT();
  const { notice } = await searchParams;
  const searchSites = getSearchSites();
  const [sources, discoverySites, jobSites] = await Promise.all([searchSites.jobDiscoverySources(), searchSites.jobDiscoverySites(), searchSites.jobSites()]);
  const shown = notice && Object.hasOwn(NOTICES, notice) ? (notice as Notice) : null;
  const status = (enabled: boolean) => t(enabled ? "admin.searchSites.enabled" : "admin.searchSites.disabled");

  /** A button switching one row on or off. */
  const toggle = (action: (form: FormData) => Promise<void>, name: string, value: string, enabled: boolean, label: string) => (
    <form action={action}>
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button className="button" type="submit">
        {t(enabled ? "admin.searchSites.disable" : "admin.searchSites.enable", { name: label })}
      </button>
    </form>
  );
  const remove = (action: (form: FormData) => Promise<void>, name: string, value: string) => (
    <form action={action}>
      <input type="hidden" name={name} value={value} />
      <button className="button" type="submit">
        {t("admin.searchSites.remove", { name: value })}
      </button>
    </form>
  );

  return (
    <main className="page">
      <BackOfficeHeader />
      <p>
        <Link href={routes.admin}>{t("admin.back")}</Link>
      </p>
      <h1>{t("admin.searchSites.title")}</h1>
      <p className="lead">{t("admin.searchSites.intro")}</p>
      {shown ? (
        <p className="notice" role={NOTICES[shown] ? "alert" : "status"}>
          {t(`admin.searchSites.notices.${shown}`)}
        </p>
      ) : null}

      <section className="stack" aria-labelledby="sources-title">
        <h2 id="sources-title">{t("admin.searchSites.sources.title")}</h2>
        <p>{t("admin.searchSites.sources.intro")}</p>
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.searchSites.sources.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.searchSites.sources.source")}</th>
                <th scope="col">{t("admin.searchSites.status")}</th>
                <th scope="col">{t("admin.searchSites.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {JOB_DISCOVERY_SOURCES.map((source) => {
                const name = t(`admin.searchSites.sources.names.${source}`);
                return (
                  <tr key={source}>
                    <th scope="row">{name}</th>
                    <td>{status(sources[source])}</td>
                    <td>{toggle(setJobDiscoverySource, FIELDS.source, source, sources[source], name)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" aria-labelledby="discovery-sites-title">
        <h2 id="discovery-sites-title">{t("admin.searchSites.discoverySites.title")}</h2>
        <p>{t("admin.searchSites.discoverySites.intro")}</p>
        <p>{t("admin.searchSites.discoverySites.forbidden", { sites: FORBIDDEN_SITES.join(", ") })}</p>
        {discoverySites.length === 0 ? (
          <p>{t("admin.searchSites.discoverySites.none")}</p>
        ) : (
          <div className="table-scroll">
            <table className="application-table">
              <caption>{t("admin.searchSites.discoverySites.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.searchSites.discoverySites.domain")}</th>
                  <th scope="col">{t("admin.searchSites.status")}</th>
                  <th scope="col">{t("admin.searchSites.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {discoverySites.map((site) => (
                  <tr key={site.domain}>
                    <th scope="row">{site.domain}</th>
                    <td>{status(site.enabled)}</td>
                    <td className="stack">
                      {toggle(setJobDiscoverySite, FIELDS.domain, site.domain, site.enabled, site.domain)}
                      {remove(removeJobDiscoverySite, FIELDS.domain, site.domain)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="stack quota-form" action={addJobDiscoverySite}>
          <fieldset>
            <legend>
              <h3>{t("admin.searchSites.discoverySites.addTitle")}</h3>
            </legend>
            <div className="stack">
              <label htmlFor="discovery-site-domain">{t("admin.searchSites.discoverySites.domain")}</label>
              <input id="discovery-site-domain" className="input" name="domain" required autoComplete="off" aria-describedby="discovery-site-domain-help" />
              <p id="discovery-site-domain-help">{t("admin.searchSites.discoverySites.domainHelp")}</p>
            </div>
            <button className="button button-primary" type="submit">
              {t("admin.searchSites.discoverySites.add")}
            </button>
          </fieldset>
        </form>
      </section>

      <section className="stack" aria-labelledby="job-sites-title">
        <h2 id="job-sites-title">{t("admin.searchSites.jobSites.title")}</h2>
        <p>{t("admin.searchSites.jobSites.intro")}</p>
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.searchSites.jobSites.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.searchSites.jobSites.pattern")}</th>
                <th scope="col">{t("admin.searchSites.jobSites.postingPages")}</th>
                <th scope="col">{t("admin.searchSites.jobSites.origin")}</th>
                <th scope="col">{t("admin.searchSites.status")}</th>
                <th scope="col">{t("admin.searchSites.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {jobSites.map((site) => (
                <tr key={site.pattern}>
                  <th scope="row">
                    <code>{site.pattern}</code>
                  </th>
                  <td>{site.postingPages ? <code>{site.postingPages}</code> : t("admin.searchSites.jobSites.anyPostingPage")}</td>
                  <td>{t(site.builtIn ? "admin.searchSites.jobSites.builtIn" : "admin.searchSites.jobSites.added")}</td>
                  <td>{status(site.enabled)}</td>
                  <td className="stack">
                    {toggle(setJobSite, FIELDS.pattern, site.pattern, site.enabled, site.pattern)}
                    {site.builtIn ? null : remove(removeJobSite, FIELDS.pattern, site.pattern)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="stack quota-form" action={addJobSite}>
          <fieldset>
            <legend>
              <h3>{t("admin.searchSites.jobSites.addTitle")}</h3>
            </legend>
            <div className="stack">
              <label htmlFor="job-site-pattern">{t("admin.searchSites.jobSites.pattern")}</label>
              <input id="job-site-pattern" className="input" name="pattern" required autoComplete="off" aria-describedby="job-site-pattern-help" />
              <p id="job-site-pattern-help">{t("admin.searchSites.jobSites.patternHelp")}</p>
            </div>
            <div className="stack">
              <label htmlFor="job-site-posting-pages">{t("admin.searchSites.jobSites.postingPagesOptional")}</label>
              <input id="job-site-posting-pages" className="input" name="postingPages" autoComplete="off" aria-describedby="job-site-posting-pages-help" />
              <p id="job-site-posting-pages-help">{t("admin.searchSites.jobSites.postingPagesHelp")}</p>
            </div>
            <button className="button button-primary" type="submit">
              {t("admin.searchSites.jobSites.add")}
            </button>
          </fieldset>
        </form>
      </section>
    </main>
  );
}
