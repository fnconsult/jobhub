"use client";

import { formatTimeOfDay } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { StreamedActionStatus, useStreamedAction, type StreamedAction } from "./StreamedAction";

type Failure = "unavailable" | "failed" | "required" | "notACompany" | { stoppedAt: Date } | null;

/**
 * Sends one Company Dossier request, its steps live in AI Activity (#335); the failure to show, or null when it worked.
 * A Stop keeps what was finished: the page is refreshed either way.
 */
async function send(action: StreamedAction, url: string, method: "POST" | "PUT", body?: object): Promise<Failure> {
  const outcome = await action.run(url, { method, ...(body ? { json: body } : {}) });
  if (outcome.ok) return null;
  if (outcome.stopped) return { stoppedAt: outcome.at };
  if (outcome.status === 503) return "unavailable";
  if (outcome.status === 400) {
    const errors = (outcome.body as { errors?: { code?: string }[] }).errors;
    return errors?.some((error) => error.code === "not_a_company") ? "notACompany" : "required";
  }
  return "failed";
}

function FailureMessage({ failure, id }: { failure: Failure; id?: string }) {
  const { t, i18n } = useTranslation();
  if (!failure) return null;
  if (typeof failure === "object") {
    return (
      <p id={id} className="notice notice-stopped" role="status">
        {t("companyDossier.stopped", { time: formatTimeOfDay(failure.stoppedAt, new Date(), i18n.language === "en" ? "en" : "fr") })}
      </p>
    );
  }
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
  const action = useStreamedAction("company_dossier");
  const [failure, setFailure] = useState<Failure>(null);

  async function build() {
    setFailure(null);
    const result = await send(action, `/api/applications/${applicationId}/company-dossier`, "POST");
    setFailure(result);
    if (!result || typeof result === "object") router.refresh();
  }

  return (
    <div className="stack">
      <button className="button button-primary" type="button" onClick={build} disabled={action.running}>
        {action.running ? t("companyDossier.working") : label}
      </button>
      <StreamedActionStatus action={action} stopLabel={t("aiActivity.live.stop.company_dossier")} />
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
  const action = useStreamedAction("company_dossier");
  const [failure, setFailure] = useState<Failure>(null);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    const result = await send(action, `/api/applications/${props.applicationId}/company-dossier/employer`, "PUT", { employer });
    setFailure(result);
    if (!result || typeof result === "object") router.refresh();
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
      <button className="button button-primary" type="submit" disabled={action.running}>
        {action.running ? t("companyDossier.working") : props.submit}
      </button>
      <StreamedActionStatus action={action} stopLabel={t("aiActivity.live.stop.company_dossier")} />
    </form>
  );
}
