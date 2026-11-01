"use client";

import type { ApplicationStatus } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationFieldError } from "@/applications";
import { buttonClass } from "@/design/button-class";
import { Drawer } from "@/design/Drawer";
import { Checkbox, Field, Select } from "@/design/Field";
import { Note } from "@/design/Note";
import { send } from "./ApplicationControls";
import { useWorkPane } from "./work-pane";
import { EMPTY_INTERVIEW_DRAFT, InterviewFields, interviewBody, type InterviewDraft } from "./InterviewFields";

/** An ongoing Application, as the Application picker offers it. */
export interface InterviewableApplication {
  id: string;
  /** The Job Offer's title. */
  jobTitle: string;
  /** The Job Offer's company, when it says. */
  employer?: string;
  status: ApplicationStatus;
}

/**
 * « Ajouter un entretien » on the Agenda (#247): a button opening a Drawer (#462) to add an
 * Interview to one of the Candidate's ongoing `applications`. For one not at "Entretien", « Passer la candidature à Entretien » (checked by default) moves it
 * there in the same request; unchecked, nothing is saved and the drawer says why. Escape or
 * its « Fermer » button closes it, the focus back on the button; once added it closes too.
 */
export function AddInterviewDialog({ applications }: { applications: InterviewableApplication[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);
  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setAdded(false);
        }}
        trigger={
          <button className={buttonClass({ variant: "primary" })} type="button">
            {t("agenda.add")}
          </button>
        }
        title={t("agenda.addDialog.title")}
        onOpenAutoFocus={(event) => {
          // On the Application picker, the first thing to choose; on the drawer itself when there is none.
          event.preventDefault();
          (firstField.current ?? (event.currentTarget as HTMLElement | null))?.focus();
        }}
      >
        {applications.length === 0 ? (
          <Note>{t("agenda.addDialog.none")}</Note>
        ) : (
          <AgendaInterviewForm
            applications={applications}
            firstField={firstField}
            onAdded={() => {
              setOpen(false);
              setAdded(true);
              router.refresh();
            }}
          />
        )}
      </Drawer>
      <p role="status" className="agenda-added">
        {added ? t("agenda.addDialog.added") : null}
      </p>
    </>
  );
}

/**
 * « Ajouter un entretien » under « Conversation au centre » (#606, ADR-0070): its form in the Work Pane beside the Agenda's
 * conversation (see InWorkPane). Once added, the pane closes, back to the
 * Agenda's address, which lists it.
 */
export function AddInterviewForm({ applications }: { applications: InterviewableApplication[] }) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  const firstField = useRef<HTMLSelectElement>(null);
  if (applications.length === 0) return <Note>{t("agenda.addDialog.none")}</Note>;
  return <AgendaInterviewForm applications={applications} firstField={firstField} onAdded={() => workPane?.close()} />;
}

/** The dialog's form: the Application, the Interview's fields and, for an Application not at "Entretien", the box moving it there. Mounted on each opening. */
function AgendaInterviewForm({
  applications,
  firstField,
  onAdded,
}: {
  applications: InterviewableApplication[];
  firstField: RefObject<HTMLSelectElement | null>;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [applicationId, setApplicationId] = useState("");
  const [moveToInterview, setMoveToInterview] = useState(true);
  const [draft, setDraft] = useState<InterviewDraft>(EMPTY_INTERVIEW_DRAFT);
  const [errors, setErrors] = useState<ApplicationFieldError[]>([]);
  const [notMoved, setNotMoved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const chosen = applications.find((application) => application.id === applicationId);
  const needsMove = chosen !== undefined && chosen.status !== "interview";
  const applicationError = errors.find((error) => error.field === "applicationId");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailed(false);
    setNotMoved(false);
    if (!chosen) {
      setErrors([{ field: "applicationId", code: "required" }]);
      firstField.current?.focus();
      return;
    }
    // Interviews are added only at "Entretien": without the move, nothing is sent.
    if (needsMove && !moveToInterview) {
      setNotMoved(true);
      return;
    }
    setWorking(true);
    const { ok, result } = await send(`/api/applications/${chosen.id}/interviews`, "POST", { ...interviewBody(draft), moveToInterview: needsMove });
    setWorking(false);
    if (ok) onAdded();
    else if (Array.isArray(result.errors)) setErrors(result.errors as ApplicationFieldError[]);
    else if (result.error === "not_in_interview") setNotMoved(true);
    else setFailed(true);
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field id={`${id}-application`} label={t("agenda.addDialog.application")} error={applicationError ? t("cvReview.required") : undefined}>
        <Select
          ref={firstField}
          required
          value={applicationId}
          onChange={(event) => {
            setApplicationId(event.target.value);
            setMoveToInterview(true);
            setNotMoved(false);
            setErrors(errors.filter((error) => error.field !== "applicationId"));
          }}
        >
          <option value="">{t("agenda.addDialog.chooseApplication")}</option>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {[application.jobTitle, application.employer, t(`applicationStatuses.${application.status}`)].filter(Boolean).join(" · ")}
            </option>
          ))}
        </Select>
      </Field>
      {needsMove ? (
        <Checkbox
          label={t("agenda.addDialog.moveToInterview")}
          hint={t("agenda.addDialog.moveToInterviewHint", { status: t(`applicationStatuses.${chosen.status}`) })}
          checked={moveToInterview}
          onChange={(event) => {
            setMoveToInterview(event.target.checked);
            setNotMoved(false);
          }}
        />
      ) : null}
      <InterviewFields id={id} draft={draft} onChange={setDraft} errors={errors} />
      <div className="actions">
        <button className={buttonClass({ variant: "primary" })} type="submit" disabled={working}>
          {working ? t("application.working") : t("agenda.addDialog.submit")}
        </button>
      </div>
      {notMoved ? (
        <Note tone="danger" role="alert">
          {t("agenda.addDialog.notMoved")}
        </Note>
      ) : null}
      {failed ? (
        <Note tone="danger" role="alert">
          {t("application.error")}
        </Note>
      ) : null}
    </form>
  );
}
