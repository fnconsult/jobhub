"use client";

import type { ApplicationStatus } from "@jobhub/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationFieldError } from "@/applications";
import { send } from "./ApplicationControls";
import { Icons } from "./icons";
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
 * « Ajouter un entretien » on the Agenda (#247): a button opening a modal dialog (Radix,
 * ADR-0018) to add an Interview to one of the Candidate's ongoing `applications`. For one
 * not at "Entretien", « Passer la candidature à Entretien » (checked by default) moves it
 * there in the same request; unchecked, nothing is saved and the dialog says why. Escape or
 * its Close button closes it, the focus back on the button; once added it closes too.
 */
export function AddInterviewDialog({ applications }: { applications: InterviewableApplication[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);
  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setAdded(false);
        }}
      >
        <Dialog.Trigger className="button button-primary" type="button">
          {t("agenda.add")}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="scrim" />
          <Dialog.Content
            className="dialog"
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              // On the Application picker, the first thing to choose; on the dialog itself when there is none.
              event.preventDefault();
              (firstField.current ?? (event.currentTarget as HTMLElement | null))?.focus();
            }}
          >
            <div className="dialog-head">
              <Dialog.Title className="dialog-title">{t("agenda.addDialog.title")}</Dialog.Title>
              <Dialog.Close className="button button-quiet">
                <Icons.close />
                {t("agenda.addDialog.close")}
              </Dialog.Close>
            </div>
            {applications.length === 0 ? (
              <p className="notice">{t("agenda.addDialog.none")}</p>
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <p role="status" className="hint">
        {added ? t("agenda.addDialog.added") : null}
      </p>
    </>
  );
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
      <div className="field">
        <label htmlFor={`${id}-application`}>{t("agenda.addDialog.application")}</label>
        <select
          id={`${id}-application`}
          ref={firstField}
          className="input"
          required
          value={applicationId}
          aria-invalid={applicationError ? true : undefined}
          aria-describedby={applicationError ? `${id}-application-error` : undefined}
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
        </select>
        {applicationError ? (
          <p id={`${id}-application-error`} className="field-error">
            {t("cvReview.required")}
          </p>
        ) : null}
      </div>
      {needsMove ? (
        <div className="checkbox-field">
          <input
            id={`${id}-move`}
            type="checkbox"
            checked={moveToInterview}
            aria-describedby={`${id}-move-hint`}
            onChange={(event) => {
              setMoveToInterview(event.target.checked);
              setNotMoved(false);
            }}
          />
          <label htmlFor={`${id}-move`}>{t("agenda.addDialog.moveToInterview")}</label>
          <p id={`${id}-move-hint`} className="hint">
            {t("agenda.addDialog.moveToInterviewHint", { status: t(`applicationStatuses.${chosen.status}`) })}
          </p>
        </div>
      ) : null}
      <InterviewFields id={id} draft={draft} onChange={setDraft} errors={errors} />
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={working}>
          {working ? t("application.working") : t("agenda.addDialog.submit")}
        </button>
      </div>
      {notMoved ? (
        <p className="field-error" role="alert">
          {t("agenda.addDialog.notMoved")}
        </p>
      ) : null}
      {failed ? (
        <p className="field-error" role="alert">
          {t("application.error")}
        </p>
      ) : null}
    </form>
  );
}
