"use client";

import { APPLICATION_STATUSES, type ApplicationStatus } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationFieldError } from "@/applications";
import type { MatchScoreFigure, MatchScoreReason } from "@/components/job-search-words";
import { EMPTY_INTERVIEW_DRAFT, InterviewFields, interviewBody, type InterviewDraft } from "@/components/InterviewFields";
import { ProfileMatchScore } from "@/components/MatchScoreWhy";
import { routes } from "@/routes";

type Outcome = "saved" | "failed" | null;

/** Sends one change to the app; `ok` when it was saved, with what the app answered. */
export async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: object): Promise<{ ok: boolean; result: Record<string, unknown> }> {
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

/**
 * The Application Status, changed by hand by the Candidate. Saved as soon as it is chosen.
 * A labelled field, or with `property`, one property of a `<dl className="props">`: its label, then the value edited in place.
 */
export function ApplicationStatusSelect({ applicationId, status, property }: { applicationId: string; status: ApplicationStatus; property?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(status);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // The status can change elsewhere (e.g. marking a Follow-up as sent): show the one the page now has.
  const [shown, setShown] = useState(status);
  if (status !== shown) {
    setShown(status);
    setValue(status);
  }

  async function change(next: ApplicationStatus) {
    setValue(next);
    setOutcome(null);
    const { ok } = await send(`/api/applications/${applicationId}`, "PATCH", { status: next });
    setOutcome(ok ? "saved" : "failed");
    if (ok) router.refresh();
    else setValue(status);
  }

  const label = <label htmlFor={id}>{t("application.statusLabel")}</label>;
  const select = (
    <select id={id} className={property ? "inline-edit" : "input"} value={value} onChange={(event) => change(event.target.value as ApplicationStatus)}>
      {APPLICATION_STATUSES.map((option) => (
        <option key={option} value={option}>
          {t(`applicationStatuses.${option}`)}
        </option>
      ))}
    </select>
  );
  const shownOutcome = <Outcome outcome={outcome} saved={t("application.statusSaved")} />;
  if (property)
    return (
      <div className="prop">
        <dt>{label}</dt>
        <dd>
          {select}
          {shownOutcome}
        </dd>
      </div>
    );
  return (
    <div className="field">
      {label}
      {select}
      {shownOutcome}
    </div>
  );
}

/** The Profile the Application uses, picked among the Candidate's active Profiles. A property row, like ApplicationStatusSelect. */
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
    <div className="prop">
      <dt>
        <label htmlFor={id}>{t("application.profileLabel")}</label>
      </dt>
      <dd>
        <select id={id} className="inline-edit" value={value} aria-describedby={`${id}-hint`} onChange={(event) => change(event.target.value)}>
          {props.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <p id={`${id}-hint`} className="hint">
          {t("application.profileHint")}
        </p>
        <Outcome outcome={outcome} saved={t("application.profileSaved")} />
      </dd>
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
  return <InterviewForm applicationId={applicationId} />;
}

/**
 * Edits one Interview: a button that opens the Interview form filled in with it.
 * `interview` holds its values as typed (`InterviewDraft`: its date and time in French
 * time, "2026-11-12T14:30"); `label` names the Interview, e.g. "Modifier l'entretien du …".
 */
export function EditInterview(props: { applicationId: string; interview: { id: string } & InterviewDraft; label: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <button className="button" type="button" onClick={() => setEditing(true)}>
        {props.label}
      </button>
    );
  return <InterviewForm applicationId={props.applicationId} interview={props.interview} onClose={() => setEditing(false)} />;
}

/**
 * The Interview form: its date and time (French time), duration, format, place or link,
 * and note. Without `interview` it adds one and empties itself; with it, it saves that
 * Interview's changes, or `onClose`s on cancel, then on saving.
 */
function InterviewForm({ applicationId, interview, onClose }: { applicationId: string; interview?: { id: string } & InterviewDraft; onClose?: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<InterviewDraft>(interview ?? EMPTY_INTERVIEW_DRAFT);
  const [working, setWorking] = useState(false);
  const [errors, setErrors] = useState<ApplicationFieldError[]>([]);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setFailed(false);
    // A datetime-local value ("2026-11-12T14:30") is French time: the app reads it so.
    const body = interviewBody(draft);
    const { ok, result } = interview
      ? await send(`/api/applications/${applicationId}/interviews/${interview.id}`, "PATCH", body)
      : await send(`/api/applications/${applicationId}/interviews`, "POST", body);
    setWorking(false);
    if (ok) {
      setErrors([]);
      if (interview) onClose?.();
      else setDraft(EMPTY_INTERVIEW_DRAFT);
      router.refresh();
    } else if (Array.isArray(result.errors)) setErrors(result.errors as ApplicationFieldError[]);
    else setFailed(true);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <InterviewFields id={id} draft={draft} onChange={setDraft} errors={errors} />
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={working}>
          {working ? t("application.working") : t(interview ? "application.saveInterview" : "application.addInterview")}
        </button>
        {interview ? (
          <button className="button" type="button" onClick={onClose} disabled={working}>
            {t("application.cancelInterviewEdit")}
          </button>
        ) : null}
      </div>
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

/**
 * Reported Unavailable: the Candidate reports the Job Offer no longer published,
 * on this Application only, or undoes it. The Application keeps its status.
 */
export function ReportUnavailableButton({ applicationId, reported }: { applicationId: string; reported: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function toggle() {
    setWorking(true);
    setOutcome(null);
    const { ok } = await send(`/api/applications/${applicationId}`, "PATCH", { reportedUnavailable: !reported });
    setWorking(false);
    if (ok) router.refresh();
    else setOutcome("failed");
  }

  return (
    <div className="field">
      {reported ? null : (
        <p id={`${id}-hint`} className="hint">
          {t("application.reportUnavailableHint")}
        </p>
      )}
      <button className="button" type="button" onClick={toggle} disabled={working} aria-describedby={reported ? undefined : `${id}-hint`}>
        {reported ? t("application.undoReport") : t("application.reportUnavailable")}
      </button>
      <Outcome outcome={outcome} saved="" />
    </div>
  );
}

/** Saves a Job Offer as an Application with the Profile the Candidate picks, then opens it. Shows the Job Offer's Match Score against the Profile picked. */
export function SaveJobOfferForm({
  jobOfferId,
  profiles,
  profileId: preselected,
}: {
  jobOfferId: string;
  /** The active Profiles, each with the Job Offer's Match Score against it and why (`matchScoreReasons`). */
  profiles: { id: string; name: string; matchScore: { figure: MatchScoreFigure; reasons: MatchScoreReason[] } }[];
  /** The Profile chosen first. */
  profileId: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [profileId, setProfileId] = useState(preselected);
  const chosen = profiles.find((profile) => profile.id === profileId);
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
      {chosen ? <ProfileMatchScore profileName={chosen.name} figure={chosen.matchScore.figure} reasons={chosen.matchScore.reasons} live t={t} /> : null}
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
