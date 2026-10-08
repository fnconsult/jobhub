import type { CompanyDossier, CompanyDossierState } from "@/company-dossiers";
import type { getServerT } from "@/i18n/server";
import { BuildCompanyDossierButton, ConfirmEmployerForm } from "./CompanyDossierControls";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * An Application's Company Dossier: how reliable it is, the employer's identity,
 * address and financials, and the Suggested Contact Roles. No person is named.
 * Before it is built: a button, or the form to name or confirm the employer.
 */
export function CompanyDossierView(props: { applicationId: string; state: CompanyDossierState | null; t: T; locale: string }) {
  const { applicationId, t, locale } = props;
  const state = props.state ?? { status: "not_built" };
  const nameEmployer = (presumedEmployer?: string) => (
    <ConfirmEmployerForm
      applicationId={applicationId}
      presumedEmployer={presumedEmployer}
      label={t("companyDossier.employerLabel")}
      hint={t("companyDossier.employerHint")}
      submit={t(presumedEmployer ? "companyDossier.confirmEmployer" : "companyDossier.nameEmployer")}
    />
  );
  return (
    <section className="stack company-dossier" aria-labelledby="company-dossier-title">
      <h2 id="company-dossier-title">{t("companyDossier.title")}</h2>
      {state.status === "not_built" ? (
        <>
          <p>{t("companyDossier.intro")}</p>
          <BuildCompanyDossierButton applicationId={applicationId} label={t("companyDossier.build")} />
        </>
      ) : state.status === "employer_unknown" ? (
        <>
          <p>{t("companyDossier.employerUnknown")}</p>
          {nameEmployer()}
        </>
      ) : state.status === "awaiting_confirmation" ? (
        <>
          <p className="notice">
            {state.agency ? t("companyDossier.postedByAgency", { agency: state.agency }) : t("companyDossier.postedByAgencyUnnamed")}{" "}
            {state.presumedEmployer ? t("companyDossier.presumedEmployer", { employer: state.presumedEmployer }) : t("companyDossier.noPresumedEmployer")}
          </p>
          <p>{t("companyDossier.confirmBeforeLookup")}</p>
          {nameEmployer(state.presumedEmployer ?? undefined)}
        </>
      ) : (
        <Dossier applicationId={applicationId} dossier={state.dossier} t={t} locale={locale} />
      )}
    </section>
  );
}

function Dossier({ applicationId, dossier, t, locale }: { applicationId: string; dossier: CompanyDossier; t: T; locale: string }) {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });
  const facts: [string, React.ReactNode][] = [];
  if (dossier.source === "french_register") {
    facts.push([t("companyDossier.facts.name"), dossier.name], [t("companyDossier.facts.siren"), dossier.siren]);
    if (dossier.legalForm) facts.push([t("companyDossier.facts.legalForm"), dossier.legalForm]);
    if (dossier.activity) facts.push([t("companyDossier.facts.activity"), dossier.activity]);
    if (dossier.address) facts.push([t("companyDossier.facts.address"), dossier.address]);
    if (dossier.headcount) {
      const { min, max } = dossier.headcount;
      facts.push([
        t("companyDossier.facts.headcount"),
        max === undefined ? t("companyDossier.headcountFrom", { min: number.format(min) }) : t("companyDossier.headcountRange", { min: number.format(min), max: number.format(max) }),
      ]);
    }
  } else {
    facts.push([t("companyDossier.facts.name"), dossier.employer]);
    if (dossier.country) facts.push([t("companyDossier.facts.country"), dossier.country]);
    if (dossier.address) facts.push([t("companyDossier.facts.address"), dossier.address]);
    if (dossier.industry) facts.push([t("companyDossier.facts.industry"), dossier.industry]);
    if (dossier.headcount) facts.push([t("companyDossier.facts.headcount"), dossier.headcount]);
    if (dossier.revenue) facts.push([t("companyDossier.facts.revenue"), dossier.revenue]);
    if (dossier.website)
      facts.push([
        t("companyDossier.facts.website"),
        <a key="website" href={dossier.website} rel="noopener noreferrer nofollow" target="_blank">
          {dossier.website}
        </a>,
      ]);
  }
  return (
    <>
      <p className={`notice reliability reliability-${dossier.reliability}`}>
        <strong>{t(`companyDossier.reliability.${dossier.reliability}`)}</strong> {t(`companyDossier.reliabilityDetail.${dossier.reliability}`)}
      </p>
      <dl className="dossier-facts">
        {facts.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {dossier.source === "french_register" ? (
        <>
          <h3>{t("companyDossier.financialsTitle")}</h3>
          {dossier.financials.length > 0 ? (
            <div className="table-scroll">
              <table className="application-table">
                <thead>
                  <tr>
                    <th scope="col">{t("companyDossier.year")}</th>
                    <th scope="col">{t("companyDossier.revenue")}</th>
                    <th scope="col">{t("companyDossier.netIncome")}</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.financials.map((year) => (
                    <tr key={year.year}>
                      <th scope="row">{year.year}</th>
                      <td>{year.revenue !== undefined ? money.format(year.revenue) : "—"}</td>
                      <td>{year.netIncome !== undefined ? money.format(year.netIncome) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{t("companyDossier.noFinancials")}</p>
          )}
          {dossier.executiveRoles.length > 0 ? (
            <>
              <h3>{t("companyDossier.executivesTitle")}</h3>
              <p className="hint">{t("companyDossier.executivesHint")}</p>
              <ul>
                {dossier.executiveRoles.map((role) => (
                  <li key={role}>{role}</li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      <h3>{t("companyDossier.contactRolesTitle")}</h3>
      <p className="hint">{t("companyDossier.contactRolesHint")}</p>
      <ul>
        {dossier.suggestedContactRoles.map((role) => (
          <li key={role}>{t(`companyDossier.contactRoles.${role}`)}</li>
        ))}
      </ul>

      {dossier.source === "web" && dossier.sources.length > 0 ? (
        <>
          <h3>{t("companyDossier.sourcesTitle")}</h3>
          <ul>
            {dossier.sources.map((source) => (
              <li key={source}>
                <a href={source} rel="noopener noreferrer nofollow" target="_blank">
                  {source}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {dossier.source === "web" ? <p className="hint">{t("companyDossier.notInRegister")}</p> : null}
      <p className="hint">{t("companyDossier.builtOn", { date: date.format(dossier.builtAt), employer: dossier.employer })}</p>
      <BuildCompanyDossierButton applicationId={applicationId} label={t("companyDossier.rebuild")} />
      <details>
        <summary>{t("companyDossier.wrongEmployer")}</summary>
        <ConfirmEmployerForm
          applicationId={applicationId}
          label={t("companyDossier.employerLabel")}
          hint={t("companyDossier.employerHint")}
          submit={t("companyDossier.nameEmployer")}
        />
      </details>
    </>
  );
}
