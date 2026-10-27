"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { markOfTool, toolById } from "@jobhub/shared";
import { routes, type ApplicationSection } from "@/routes";

/** One of the Profile's Target Companies, as its Section shows it (#409). */
export interface TargetCompanyItem {
  id: string;
  name: string;
  /** The Candidate added it (else La Bonne Boite gave it). */
  own: boolean;
  city: string | null;
  activity: string | null;
  headcount: { min: number; max: number | null } | null;
  /** La Bonne Boite's hiring potential, 0 to 100; null for one the Candidate added. */
  hiringScore: number | null;
  /** The Job Offers the Profile's Job Searches found there. */
  jobOffers: { id: string; title: string }[];
  /** The Candidate's Spontaneous Application to it, once prepared. */
  spontaneousApplicationId: string | null;
}

type AddError = "invalid" | "exists" | "not_a_company";

/** The Spontaneous Application's Sections its Company Dossier and its Enriched Contacts are in. */
const DOSSIER: ApplicationSection = "dossier";
const CONTACTS: ApplicationSection = "contacts";

/**
 * « Entreprises cibles » (#409): the Profile's Target Companies, La Bonne Boite's credited to France Travail (its
 * terms ask for its logo), each with what the Candidate can do there: open its Company Dossier, look for Enriched
 * Contacts, prepare a Spontaneous Application (the three happen in that Application), or set it aside for good; and a
 * company added by name, resolved in the company register.
 */
export function TargetCompanies({ profileId, companies }: { profileId: string; companies: TargetCompanyItem[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const inputId = useId();
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<AddError | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [said, setSaid] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const base = `/api/profiles/${encodeURIComponent(profileId)}/target-companies`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("add");
    setAddError(null);
    setFailed(false);
    setSaid("");
    try {
      const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        setName("");
        setSaid(t("targetCompanies.added", { name: result.company?.name ?? name }));
        router.refresh();
      } else if (Array.isArray(result.errors) && result.errors[0]?.code) setAddError(result.errors[0].code);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setWorking(null);
    }
  }

  async function setAside(company: TargetCompanyItem) {
    setWorking(company.id);
    setFailed(false);
    setSaid("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(company.id)}/set-aside`, { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      setConfirming(null);
      setSaid(t("targetCompanies.setAsideDone", { name: company.name }));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setWorking(null);
    }
  }

  /** Goes to the company's Spontaneous Application (`section` of it), prepared first when it is not yet. */
  async function openApplication(company: TargetCompanyItem, section?: ApplicationSection) {
    setWorking(company.id);
    setFailed(false);
    try {
      const response = await fetch(`${base}/${encodeURIComponent(company.id)}/spontaneous-application`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.applicationId !== "string") throw new Error(String(response.status));
      router.push(section ? routes.applicationSection(result.applicationId, section) : routes.application(result.applicationId));
    } catch {
      setFailed(true);
      setWorking(null);
    }
  }

  const headcountOf = ({ min, max }: { min: number; max: number | null }) =>
    max === null ? t("companyDossier.headcountFrom", { min }) : t("companyDossier.headcountRange", { min, max });

  return (
    <section className="section target-companies" aria-labelledby="target-companies">
      <div className="section-head">
        <h2 id="target-companies">{t("targetCompanies.title")}</h2>
      </div>
      <p className="hint">{t("targetCompanies.intro")}</p>
      <p className="target-companies-source">
        {t("targetCompanies.source")} <FranceTravailMark />
      </p>

      {companies.length === 0 ? (
        <p className="notice">{t("targetCompanies.empty")}</p>
      ) : (
        <ul className="rows" aria-label={t("targetCompanies.listLabel")}>
          {companies.map((company) => {
            const titleId = `target-company-${company.id}`;
            const facts = [
              company.own ? t("targetCompanies.yours") : null,
              company.city,
              company.activity,
              company.headcount ? headcountOf(company.headcount) : null,
              company.hiringScore === null ? null : t("targetCompanies.hiringScore", { score: Math.round(company.hiringScore) }),
            ].filter((fact): fact is string => !!fact);
            const busy = working !== null;
            const application = company.spontaneousApplicationId;
            /** A link to the prepared Spontaneous Application's `section`, else a button that prepares it and goes there. */
            const toApplication = (label: string, section?: ApplicationSection, primary = false) =>
              application ? (
                <Link className={primary ? "button button-primary" : "button"} href={section ? routes.applicationSection(application, section) : routes.application(application)} aria-describedby={titleId}>
                  {label}
                </Link>
              ) : (
                <button className={primary ? "button button-primary" : "button"} type="button" disabled={busy} aria-describedby={titleId} onClick={() => openApplication(company, section)}>
                  {working === company.id ? t("targetCompanies.working") : label}
                </button>
              );
            return (
              <li key={company.id} className="row">
                <div className="row-main">
                  <h3 className="row-title" id={titleId}>
                    {company.name}
                  </h3>
                  <p className="row-meta">
                    {facts.map((fact) => (
                      <span key={fact}>{fact}</span>
                    ))}
                  </p>
                  {company.jobOffers.length === 0 ? (
                    <p className="hint">{t("targetCompanies.noOffers")}</p>
                  ) : (
                    <div className="target-company-offers">
                      <p className="hint">{t("targetCompanies.offersFound", { count: company.jobOffers.length })}</p>
                      <ul aria-label={t("targetCompanies.offersLabel", { name: company.name })}>
                        {company.jobOffers.map((offer) => (
                          <li key={offer.id}>
                            <Link href={routes.jobOffer(offer.id, profileId)}>{offer.title}</Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  {toApplication(t("targetCompanies.openDossier"), DOSSIER)}
                  {toApplication(t("targetCompanies.findContacts"), CONTACTS)}
                  {toApplication(t(application ? "targetCompanies.seeApplication" : "targetCompanies.prepareApplication"), undefined, true)}
                  {confirming === company.id ? (
                    <span className="target-company-confirm" role="group" aria-label={t("targetCompanies.setAside")}>
                      <span>{t("targetCompanies.setAsideConfirm", { name: company.name })}</span>
                      <button className="button button-danger" type="button" disabled={busy} onClick={() => setAside(company)}>
                        {working === company.id ? t("targetCompanies.working") : t("targetCompanies.confirmSetAside")}
                      </button>
                      <button className="button button-quiet" type="button" disabled={busy} onClick={() => setConfirming(null)}>
                        {t("targetCompanies.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button className="button button-quiet" type="button" disabled={busy} aria-describedby={titleId} onClick={() => setConfirming(company.id)}>
                      {t("targetCompanies.setAside")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {companies.length > 0 ? <p className="hint">{t("targetCompanies.spontaneousHint")}</p> : null}

      <p role="status" className="visually-hidden">
        {said}
      </p>
      {failed ? (
        <p className="notice notice-failed" role="alert">
          {t("targetCompanies.failed")}
        </p>
      ) : null}

      <form className="stack" onSubmit={add} noValidate aria-labelledby="target-companies-add">
        <h3 id="target-companies-add">{t("targetCompanies.addTitle")}</h3>
        <div className="field">
          <label htmlFor={inputId}>{t("targetCompanies.addLabel")}</label>
          <p id={`${inputId}-hint`} className="hint">
            {t("targetCompanies.addHint")}
          </p>
          <input
            id={inputId}
            className="input"
            value={name}
            maxLength={200}
            autoComplete="organization"
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? `${inputId}-hint ${inputId}-error` : `${inputId}-hint`}
            onChange={(event) => setName(event.target.value)}
          />
          {addError ? (
            <p id={`${inputId}-error`} className="field-error">
              {t(`targetCompanies.errors.${addError}`)}
            </p>
          ) : null}
        </div>
        <button className="button" type="submit" disabled={working !== null}>
          {working === "add" ? t("targetCompanies.adding") : t("targetCompanies.add")}
        </button>
      </form>
    </section>
  );
}

/**
 * France Travail, credited where La Bonne Boite's companies are shown: its terms ask for its logo. Its Tool's mark, the
 * same `Tool.logo` AI Activity shows: the official logo once France Travail gave it (#424), until then its name as a
 * wordmark (the logo is France Travail's to give, not to redraw).
 */
function FranceTravailMark() {
  const mark = markOfTool(toolById("france-travail"));
  const name = mark.text ?? FRANCE_TRAVAIL;
  if (mark.logo) return <img className="france-travail-logo" src={mark.logo} alt={name} />;
  return (
    <span className="france-travail-mark" role="img" aria-label={name}>
      <span aria-hidden="true">{name}</span>
    </span>
  );
}

/** A proper name, the same in every language. */
const FRANCE_TRAVAIL = "France Travail";
