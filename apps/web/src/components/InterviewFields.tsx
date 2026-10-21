"use client";

import { INTERVIEW_FORMATS, type InterviewFormat } from "@jobhub/shared";
import { useTranslation } from "react-i18next";
import type { ApplicationFieldError } from "@/applications";

/** An Interview as its form holds it, every value as typed: `scheduledAt` in French time ("2026-11-12T14:30"), "" for nothing said. */
export interface InterviewDraft {
  scheduledAt: string;
  durationMinutes: string;
  format: InterviewFormat | "";
  place: string;
  note: string;
}

export const EMPTY_INTERVIEW_DRAFT: InterviewDraft = { scheduledAt: "", durationMinutes: "", format: "", place: "", note: "" };

/** What the app is sent for a draft: a duration typed as digits goes as a number, anything else as typed for the app to refuse. */
export function interviewBody(draft: InterviewDraft) {
  const duration = draft.durationMinutes.trim();
  return { ...draft, durationMinutes: /^\d+$/.test(duration) ? Number(duration) : duration };
}

/**
 * The fields of an Interview form: date and time (French time), duration, format, place or
 * link, and note, each labelled, with the errors the app sent back. `id` prefixes their ids.
 */
export function InterviewFields({ id, draft, onChange, errors }: { id: string; draft: InterviewDraft; onChange: (draft: InterviewDraft) => void; errors: ApplicationFieldError[] }) {
  const { t } = useTranslation();
  const change = (field: keyof InterviewDraft) => (event: { target: { value: string } }) => onChange({ ...draft, [field]: event.target.value });
  const error = (field: string) => errors.find((each) => each.field === field);
  /** The error under a field, and the ids it is described by. */
  const described = (field: string, hint?: string) => {
    const fieldError = error(field);
    const ids = [hint, fieldError ? `${id}-${field}-error` : undefined].filter(Boolean).join(" ");
    return {
      props: { "aria-invalid": fieldError ? true : undefined, "aria-describedby": ids || undefined },
      message: fieldError ? (
        <p id={`${id}-${field}-error`} className="field-error">
          {t(fieldError.code === "required" ? "cvReview.required" : "cvReview.invalidValue")}
        </p>
      ) : null,
    };
  };
  const date = described("scheduledAt");
  const duration = described("durationMinutes", `${id}-duration-hint`);
  const format = described("format");
  const place = described("place", `${id}-place-hint`);
  return (
    <>
      <div className="field">
        <label htmlFor={`${id}-date`}>{t("application.interviewDate")}</label>
        <input id={`${id}-date`} className="input" type="datetime-local" required value={draft.scheduledAt} {...date.props} onChange={change("scheduledAt")} />
        {date.message}
      </div>
      <div className="field">
        <label htmlFor={`${id}-duration`}>{t("application.interviewDuration")}</label>
        <p id={`${id}-duration-hint`} className="hint">
          {t("application.interviewDurationHint")}
        </p>
        <input
          id={`${id}-duration`}
          className="input"
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          step={1}
          value={draft.durationMinutes}
          {...duration.props}
          onChange={change("durationMinutes")}
        />
        {duration.message}
      </div>
      <div className="field">
        <label htmlFor={`${id}-format`}>{t("application.interviewFormat")}</label>
        <select id={`${id}-format`} className="input" value={draft.format} {...format.props} onChange={change("format")}>
          <option value="">{t("application.interviewFormatNone")}</option>
          {INTERVIEW_FORMATS.map((option) => (
            <option key={option} value={option}>
              {t(`interviewFormats.${option}`)}
            </option>
          ))}
        </select>
        {format.message}
      </div>
      <div className="field">
        <label htmlFor={`${id}-place`}>{t("application.interviewPlace")}</label>
        <p id={`${id}-place-hint`} className="hint">
          {t("application.interviewPlaceHint")}
        </p>
        <input id={`${id}-place`} className="input" maxLength={500} value={draft.place} {...place.props} onChange={change("place")} />
        {place.message}
      </div>
      <div className="field">
        <label htmlFor={`${id}-note`}>{t("application.interviewNote")}</label>
        <p id={`${id}-note-hint`} className="hint">
          {t("application.interviewNoteHint")}
        </p>
        <input id={`${id}-note`} className="input" maxLength={500} value={draft.note} aria-describedby={`${id}-note-hint`} onChange={change("note")} />
      </div>
    </>
  );
}
