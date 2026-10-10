"use client";

import type { MasterCvContent } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import type { CvDraft, CvFileErrorCode } from "@/cv";
import type { ProfileFieldError } from "@/profiles";
import { routes } from "@/routes";
import { MasterCvFields } from "./MasterCvFields";
import { criteriaFieldsOf, SearchCriteriaFields, searchCriteriaInput, useSearchCriteriaLabels, type CriteriaFields } from "./SearchCriteriaFields";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";

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

/** The draft a Candidate starts from when they start from scratch: the review form left blank. */
export const BLANK_DRAFT: CvDraft = { masterCv: BLANK_MASTER_CV, searchCriteria: { targetRole: "", location: "" } };

const FILE_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

/** Uploading a PDF or Word CV and reading it into a draft. Saves nothing. */
export function CvUpload({ onDraft }: { onDraft: (draft: CvDraft) => void }) {
  const { t } = useTranslation();
  const fileId = useId();
  const [state, setState] = useState<{ reading: boolean; error?: CvFileErrorCode | "unknown" }>({ reading: false });

  async function readCv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ reading: true });
    try {
      const response = await fetch("/api/cv/draft", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setState({ reading: false, error: FILE_ERRORS.has(body.error) ? body.error : "unknown" });
        return;
      }
      onDraft(body as CvDraft);
    } catch {
      setState({ reading: false, error: "unknown" });
    }
  }

  return (
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
      <button className="button button-primary" type="submit" disabled={state.reading}>
        {state.reading ? t("cvUpload.reading") : t("cvUpload.submit")}
      </button>
      {state.reading ? (
        <p className="notice" role="status">
          {t("cvUpload.reading")}
        </p>
      ) : null}
      {state.error ? (
        <p className="notice" role="alert">
          {t(`cvUpload.errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  );
}

interface ReviewState {
  masterCv: MasterCvContent;
  criteria: CriteriaFields;
  saving: boolean;
  errors: ProfileFieldError[];
  failed: boolean;
  quotaReached: boolean;
  /** What the Candidate's Plan allows and which Plan allows more, when the Plan Quota refused the Profile. */
  upgradePrompt: Prompt | null;
}

/**
 * Reviewing a draft Master CV and Search Criteria, whether read from an uploaded
 * CV, built by the Onboarding Questionnaire or left blank to start from scratch,
 * then saving it as a Profile.
 */
export function CvReview(props: { draft: CvDraft; intro: string; startOverLabel: string; onStartOver: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [review, setReview] = useState<ReviewState>(() => ({
    masterCv: props.draft.masterCv,
    criteria: criteriaFieldsOf({ targetRole: props.draft.searchCriteria.targetRole, location: props.draft.searchCriteria.location }),
    saving: false,
    errors: [],
    failed: false,
    quotaReached: false,
    upgradePrompt: null,
  }));
  const update = (changes: Partial<ReviewState>) => setReview((current) => ({ ...current, ...changes }));
  const setCriteria = (changes: Partial<CriteriaFields>) => setReview((current) => ({ ...current, criteria: { ...current.criteria, ...changes } }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { criteria, masterCv } = review;
    const searchCriteria = searchCriteriaInput(criteria);
    update({ saving: true, failed: false, quotaReached: false, upgradePrompt: null });
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
      update({
        saving: false,
        errors: Array.isArray(body.errors) ? body.errors : [],
        failed: !Array.isArray(body.errors) && !quotaReached,
        quotaReached,
        upgradePrompt: quotaReached ? upgradePromptIn(body) : null,
      });
    } catch {
      update({ saving: false, failed: true });
    }
  }

  const fieldLabels = useSearchCriteriaLabels();
  const invalidFields = [...new Set(review.errors.map((error) => fieldLabels[error.field] ?? error.field))];

  return (
    <form className="stack review" onSubmit={save} noValidate>
      <h2>{t("cvReview.title")}</h2>
      <p>{props.intro}</p>

      <fieldset className="fieldset">
        <legend>{t("cvReview.searchCriteria")}</legend>
        <SearchCriteriaFields value={review.criteria} onChange={setCriteria} errors={review.errors} />
      </fieldset>

      <MasterCvFields value={review.masterCv} onChange={(masterCv) => update({ masterCv })} />

      {invalidFields.length > 0 ? (
        <p className="notice" role="alert">
          {t("cvReview.invalid", { fields: invalidFields.join(", ") })}
        </p>
      ) : null}
      {review.upgradePrompt ? (
        <UpgradePrompt prompt={review.upgradePrompt} />
      ) : review.quotaReached ? (
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
        <button className="button" type="button" onClick={props.onStartOver}>
          {props.startOverLabel}
        </button>
      </div>
    </form>
  );
}
