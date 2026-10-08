"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

type Failure = "unavailable" | "failed" | "required" | "notACompany" | null;

/** Sends one Company Dossier request; the failure to show, or null when it worked. */
async function send(url: string, method: "POST" | "PUT", body?: object): Promise<Failure> {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) return null;
    if (response.status === 503) return "unavailable";
    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as { errors?: { code?: string }[] } | null;
      return body?.errors?.some((error) => error.code === "not_a_company") ? "notACompany" : "required";
    }
    return "failed";
  } catch {
    return "failed";
  }
}

function FailureMessage({ failure, id }: { failure: Failure; id?: string }) {
  const { t } = useTranslation();
  if (!failure) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {t(
        failure === "unavailable"
          ? "companyDossier.unavailable"
          : failure === "notACompany"
            ? "companyDossier.notACompany"
            : failure === "required"
              ? "cvReview.required"
              : "application.error",
      )}
    </p>
  );
}

/** Builds (again) the Company Dossier of an Application. */
export function BuildCompanyDossierButton({ applicationId, label }: { applicationId: string; label: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function build() {
    setWorking(true);
    setFailure(null);
    const result = await send(`/api/applications/${applicationId}/company-dossier`, "POST");
    setWorking(false);
    setFailure(result);
    if (!result) router.refresh();
  }

  return (
    <div className="stack">
      <button className="button button-primary" type="button" onClick={build} disabled={working}>
        {working ? t("companyDossier.working") : label}
      </button>
      <FailureMessage failure={failure} />
    </div>
  );
}

/**
 * The Candidate names the employer: confirms the Presumed Employer (filled in), or
 * types another name or a SIREN. Nothing is looked up before they submit.
 */
export function ConfirmEmployerForm(props: { applicationId: string; presumedEmployer?: string; label: string; hint: string; submit: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [employer, setEmployer] = useState(props.presumedEmployer ?? "");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setFailure(null);
    const result = await send(`/api/applications/${props.applicationId}/company-dossier/employer`, "PUT", { employer });
    setWorking(false);
    setFailure(result);
    if (!result) router.refresh();
  }

  return (
    <form className="stack" onSubmit={confirm} noValidate>
      <div className="field">
        <label htmlFor={id}>{props.label}</label>
        <p id={`${id}-hint`} className="hint">
          {props.hint}
        </p>
        <input
          id={id}
          className="input"
          required
          maxLength={200}
          value={employer}
          aria-invalid={failure === "required" || failure === "notACompany" ? true : undefined}
          aria-describedby={failure ? `${id}-hint ${id}-error` : `${id}-hint`}
          onChange={(event) => setEmployer(event.target.value)}
        />
        <FailureMessage failure={failure} id={`${id}-error`} />
      </div>
      <button className="button button-primary" type="submit" disabled={working}>
        {working ? t("companyDossier.working") : props.submit}
      </button>
    </form>
  );
}
