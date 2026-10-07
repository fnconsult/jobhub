"use client";

import { APPLICATION_STATUSES, type ApplicationStatus } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationFieldError } from "@/applications";
import { routes } from "@/routes";

type Outcome = "saved" | "failed" | null;

/** Sends one change to the app; true when it was saved. */
async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<{ ok: boolean; result: Record<string, unknown> }> {
  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: response.ok, result: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, result: {} };
  }
}

/** The Application Status, changed by hand by the Candidate. Saved as soon as it is chosen. */
export function ApplicationStatusSelect({ applicationId, status }: { applicationId: string; status: ApplicationStatus }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(status);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function change(next: ApplicationStatus) {
    setValue(next);
    setOutcome(null);
    const { ok } = await send(`/api/applications/${applicationId}`, "PATCH", { status: next });
    setOutcome(ok ? "saved" : "failed");
    if (ok) router.refresh();
    else setValue(status);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{t("application.statusLabel")}</label>
      <select id={id} className="input" value={value} onChange={(event) => change(event.target.value as ApplicationStatus)}>
        {APPLICATION_STATUSES.map((option) => (
          <option key={option} value={option}>
            {t(`applicationStatuses.${option}`)}
          </option>
        ))}
      </select>
      <Outcome outcome={outcome} saved={t("application.statusSaved")} />
    </div>
  );
}

/** The Profile the Application uses, picked among the Candidate's active Profiles. */
export function ApplicationProfileSelect(props: { applicationId: string; profileId: string; profiles: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(props.profileId);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function change(next: string) {
    setValue(next);
    setOutcome(null);
    const { ok } = await send(`/api/applications/${props.applicationId}`, "PATCH", { profileId: next });
    setOutcome(ok ? "saved" : "failed");
    if (ok) router.refresh();
    else setValue(props.profileId);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{t("application.profileLabel")}</label>
      <p id={`${id}-hint`} className="hint">
        {t("application.profileHint")}
      </p>
      <select id={id} className="input" value={value} aria-describedby={`${id}-hint`} onChange={(event) => change(event.target.value)}>
        {props.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
      <Outcome outcome={outcome} saved={t("application.profileSaved")} />
    </div>
  );
}

function Outcome({ outcome, saved }: { outcome: Outcome; saved: string }) {
  const { t } = useTranslation();
  if (outcome === "saved") return <p role="status">{saved}</p>;
  if (outcome === "failed")
    return (
      <p className="field-error" role="alert">
        {t("application.error")}
      </p>
    );
  return null;
}

/** Adds a dated Interview to an Application at "Entretien". */
export function AddInterviewForm({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [scheduledAt, setScheduledAt] = useState("");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [errors, setErrors] = useState<ApplicationFieldError[]>([]);
  const [failed, setFailed] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setFailed(false);
    // A datetime-local value ("2026-11-12T14:30") is French time: the app reads it so.
    const { ok, result } = await send(`/api/applications/${applicationId}/interviews`, "POST", { scheduledAt, note });
    setWorking(false);
    if (ok) {
      setErrors([]);
      setScheduledAt("");
      setNote("");
      router.refresh();
    } else if (Array.isArray(result.errors)) setErrors(result.errors as ApplicationFieldError[]);
    else setFailed(true);
  }

  const dateError = errors.find((error) => error.field === "scheduledAt");
  return (
    <form className="stack" onSubmit={add} noValidate>
      <div className="field">
        <label htmlFor={`${id}-date`}>{t("application.interviewDate")}</label>
        <input
          id={`${id}-date`}
          className="input"
          type="datetime-local"
          required
          value={scheduledAt}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? `${id}-date-error` : undefined}
          onChange={(event) => setScheduledAt(event.target.value)}
        />
        {dateError ? (
          <p id={`${id}-date-error`} className="field-error">
            {t(dateError.code === "required" ? "cvReview.required" : "cvReview.invalidValue")}
          </p>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>{t("application.interviewNote")}</label>
        <p id={`${id}-note-hint`} className="hint">
          {t("application.interviewNoteHint")}
        </p>
        <input id={`${id}-note`} className="input" maxLength={500} value={note} aria-describedby={`${id}-note-hint`} onChange={(event) => setNote(event.target.value)} />
      </div>
      <button className="button button-primary" type="submit" disabled={working}>
        {working ? t("application.working") : t("application.addInterview")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("application.error")}
        </p>
      ) : null}
    </form>
  );
}

/** Removes one Interview, recorded by mistake. */
export function RemoveInterviewButton({ applicationId, interviewId, label }: { applicationId: string; interviewId: string; label: string }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  async function remove() {
    setWorking(true);
    const { ok } = await send(`/api/applications/${applicationId}/interviews/${interviewId}`, "DELETE");
    setWorking(false);
    if (ok) router.refresh();
  }
  return (
    <button className="button" type="button" onClick={remove} disabled={working}>
      {label}
    </button>
  );
}

/** Saves a Job Offer as an Application with the Profile the Candidate picks, then opens it. */
export function SaveJobOfferForm({ jobOfferId, profiles }: { jobOfferId: string; profiles: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setFailed(false);
    const { ok, result } = await send("/api/applications", "POST", { jobOfferId, profileId });
    if (ok && typeof result.id === "string") router.push(routes.application(result.id));
    else {
      setWorking(false);
      setFailed(true);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <div className="field">
        <label htmlFor={id}>{t("jobOffer.profileLabel")}</label>
        <select id={id} className="input" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>
      <button className="button button-primary" type="submit" disabled={working}>
        {working ? t("jobOffer.saving") : t("jobOffer.save")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("jobOffer.error")}
        </p>
      ) : null}
    </form>
  );
}
