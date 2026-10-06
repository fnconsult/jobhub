"use client";

import { CONTRACT_TYPES, REMOTE_WORK_OPTIONS, type MasterCvContent } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft, CvFileErrorCode } from "@/cv";
import type { ProfileFieldError } from "@/profiles";
import { routes } from "@/routes";
import { SelectField, TextField } from "./form-fields";
import { MasterCvFields } from "./MasterCvFields";

/** Search Criteria as the review form holds them: what the inputs show. */
interface CriteriaFields {
  targetRole: string;
  location: string;
  minSalary: string;
  contractType: string;
  remoteWork: string;
}

type Step =
  | { kind: "upload"; reading: boolean; error?: CvFileErrorCode | "unknown" }
  | {
      kind: "review";
      /** Whether the Candidate started from scratch rather than from a CV. */
      fromScratch: boolean;
      masterCv: MasterCvContent;
      criteria: CriteriaFields;
      saving: boolean;
      errors: ProfileFieldError[];
      failed: boolean;
      quotaReached: boolean;
    };

const BLANK_MASTER_CV: MasterCvContent = {
  fullName: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};
const BLANK_CRITERIA: CriteriaFields = { targetRole: "", location: "", minSalary: "", contractType: "", remoteWork: "" };

const FILE_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

/**
 * Creating a Profile from a CV: the Candidate uploads a PDF or Word CV, then
 * reviews and corrects the Master CV and Search Criteria read from it before
 * anything is saved. Or they start from scratch, on the same form left blank.
 */
function reviewOf(masterCv: MasterCvContent, criteria: CriteriaFields, fromScratch: boolean): Step {
  return { kind: "review", fromScratch, masterCv, criteria, saving: false, errors: [], failed: false, quotaReached: false };
}

export function CvOnboarding() {
  const { t } = useTranslation();
  const router = useRouter();
  const fileId = useId();
  const [step, setStep] = useState<Step>({ kind: "upload", reading: false });

  async function readCv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setStep({ kind: "upload", reading: true });
    try {
      const response = await fetch("/api/cv/draft", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStep({ kind: "upload", reading: false, error: FILE_ERRORS.has(body.error) ? body.error : "unknown" });
        return;
      }
      const draft = body as CvDraft;
      setStep(reviewOf(draft.masterCv, { ...BLANK_CRITERIA, targetRole: draft.searchCriteria.targetRole, location: draft.searchCriteria.location }, false));
    } catch {
      setStep({ kind: "upload", reading: false, error: "unknown" });
    }
  }

  if (step.kind === "upload") {
    return (
      <>
        <form className="stack" onSubmit={readCv}>
          <label htmlFor={fileId}>{t("cvUpload.fileLabel")}</label>
          <p id={`${fileId}-hint`} className="hint">
            {t("cvUpload.fileHint")}
          </p>
          <input
            id={fileId}
            className="input"
            name="cv"
            type="file"
            required
            aria-describedby={`${fileId}-hint`}
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
          <button className="button button-primary" type="submit" disabled={step.reading}>
            {step.reading ? t("cvUpload.reading") : t("cvUpload.submit")}
          </button>
          {step.reading ? (
            <p className="notice" role="status">
              {t("cvUpload.reading")}
            </p>
          ) : null}
          {step.error ? (
            <p className="notice" role="alert">
              {t(`cvUpload.errors.${step.error}`)}
            </p>
          ) : null}
        </form>
        <div className="stack">
          <p>{t("cvUpload.fromScratchHint")}</p>
          <button className="button" type="button" disabled={step.reading} onClick={() => setStep(reviewOf(BLANK_MASTER_CV, BLANK_CRITERIA, true))}>
            {t("cvUpload.fromScratch")}
          </button>
        </div>
      </>
    );
  }

  const review = step;
  const update = (changes: Partial<Extract<Step, { kind: "review" }>>) => setStep({ ...review, ...changes });
  const setCriteria = (changes: Partial<CriteriaFields>) => update({ criteria: { ...review.criteria, ...changes } });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { criteria, masterCv } = review;
    const salary = criteria.minSalary.replace(/[\s.]/g, "");
    const searchCriteria = {
      targetRole: criteria.targetRole,
      location: criteria.location,
      ...(salary ? { minSalary: /^\d+$/.test(salary) ? Number(salary) : salary } : {}),
      ...(criteria.contractType ? { contractType: criteria.contractType } : {}),
      ...(criteria.remoteWork ? { remoteWork: criteria.remoteWork } : {}),
    };
    update({ saving: true, failed: false, quotaReached: false });
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ masterCv, searchCriteria }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 201) {
        router.push(routes.profile(body.id));
        return;
      }
      const quotaReached = body.error === "plan_quota_reached";
      update({ saving: false, errors: Array.isArray(body.errors) ? body.errors : [], failed: !Array.isArray(body.errors) && !quotaReached, quotaReached });
    } catch {
      update({ saving: false, failed: true });
    }
  }

  const criteriaError = Object.fromEntries(
    review.errors.flatMap((error) => (error.field.startsWith("searchCriteria.") ? [[error.field.slice("searchCriteria.".length), error]] : [])),
  ) as Partial<Record<keyof CriteriaFields, ProfileFieldError>>;
  const fieldLabels: Record<string, string> = {
    "searchCriteria.targetRole": t("cvReview.targetRole"),
    "searchCriteria.location": t("cvReview.location"),
    "searchCriteria.minSalary": t("cvReview.minSalary"),
    "searchCriteria.contractType": t("cvReview.contractType"),
    "searchCriteria.remoteWork": t("cvReview.remoteWork"),
  };
  const invalidFields = [...new Set(review.errors.map((error) => fieldLabels[error.field] ?? error.field))];

  return (
    <form className="stack review" onSubmit={save} noValidate>
      <h2>{t("cvReview.title")}</h2>
      <p>{t(review.fromScratch ? "cvReview.scratchIntro" : "cvReview.intro")}</p>

      <fieldset className="fieldset">
        <legend>{t("cvReview.searchCriteria")}</legend>
        <TextField label={t("cvReview.targetRole")} value={review.criteria.targetRole} onChange={(targetRole) => setCriteria({ targetRole })} error={criteriaError.targetRole} required />
        <TextField label={t("cvReview.location")} value={review.criteria.location} onChange={(location) => setCriteria({ location })} error={criteriaError.location} required />
        <TextField label={t("cvReview.minSalary")} value={review.criteria.minSalary} onChange={(minSalary) => setCriteria({ minSalary })} error={criteriaError.minSalary} numeric />
        <SelectField
          label={t("cvReview.contractType")}
          value={review.criteria.contractType}
          onChange={(contractType) => setCriteria({ contractType })}
          options={CONTRACT_TYPES.map((value) => [value, t(`cvReview.contractTypes.${value}`)])}
          error={criteriaError.contractType}
        />
        <SelectField
          label={t("cvReview.remoteWork")}
          value={review.criteria.remoteWork}
          onChange={(remoteWork) => setCriteria({ remoteWork })}
          options={REMOTE_WORK_OPTIONS.map((value) => [value, t(`cvReview.remoteWorkOptions.${value}`)])}
          error={criteriaError.remoteWork}
        />
      </fieldset>

      <MasterCvFields value={review.masterCv} onChange={(masterCv) => update({ masterCv })} />

      {invalidFields.length > 0 ? (
        <p className="notice" role="alert">
          {t("cvReview.invalid", { fields: invalidFields.join(", ") })}
        </p>
      ) : null}
      {review.quotaReached ? (
        <p className="notice" role="alert">
          {t("profiles.quotaReached")}
        </p>
      ) : null}
      {review.failed ? (
        <p className="notice" role="alert">
          {t("cvReview.error")}
        </p>
      ) : null}
      <div className="actions">
        <button className="button button-primary" type="submit" disabled={review.saving}>
          {review.saving ? t("cvReview.saving") : t("cvReview.save")}
        </button>
        <button className="button" type="button" onClick={() => setStep({ kind: "upload", reading: false })}>
          {t("cvReview.startOver")}
        </button>
      </div>
    </form>
  );
}
