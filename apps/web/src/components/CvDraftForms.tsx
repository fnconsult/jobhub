"use client";

import { formatTimeOfDay, type Activity, type MasterCvContent } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import type { CvDraft, CvFileErrorCode } from "@/cv";
import { MAX_CV_FILE_BYTES } from "@/cv/limits";
import { FileUpload } from "@/design/FileUpload";
import type { ProfileFieldError } from "@/profiles";
import { routes } from "@/routes";
import { MasterCvFields } from "./MasterCvFields";
import { useStreamedAction } from "./StreamedAction";
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
export const BLANK_DRAFT: CvDraft = { masterCv: BLANK_MASTER_CV, searchCriteria: { targetRole: "", locations: [] } };

const FILE_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

/** What a CV file may be (#468): a PDF or a Word file, as the server reads them, up to its limit. */
const CV_FILE_RULES = { maxBytes: MAX_CV_FILE_BYTES, extensions: ["pdf", "docx"] } as const;
/** The glyph on the file's row until the reading's first step names its own. */
const READING: Activity = "read";
const CV_FILE_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Uploading a PDF or Word CV and reading it into a draft, in the Design System's File upload (#468): dropped or
 * chosen, refused at once when the File upload's rules say so. Saves nothing. The AI Coach's reading shows live, on
 * the file's row and in AI Activity, and the Candidate can stop it (#335): nothing is then drafted. Without a CV, the
 * Candidate starts from scratch (`onFromScratch`).
 */
export function CvUpload({ onDraft, onFromScratch }: { onDraft: (draft: CvDraft) => void; onFromScratch?: () => void }) {
  const { t, i18n } = useTranslation();
  const action = useStreamedAction("cv_reading");
  const [chosen, setChosen] = useState(false);
  const [state, setState] = useState<{ error?: CvFileErrorCode | "unknown"; stoppedAt?: Date }>({});
  const reading = action.running;
  const errors = t("cvUpload.errors", { returnObjects: true }) as Record<CvFileErrorCode | "unknown", string>;

  async function readCv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({});
    const outcome = await action.run("/api/cv/draft", { method: "POST", body: form });
    if (outcome.ok) onDraft(outcome.body as unknown as CvDraft);
    else if (outcome.stopped) setState({ stoppedAt: outcome.at });
    else setState({ error: FILE_ERRORS.has(String(outcome.body.error)) ? (outcome.body.error as CvFileErrorCode) : "unknown" });
  }

  return (
    <form className="stack" onSubmit={readCv}>
      <FileUpload
        name="cv"
        label={t("cvUpload.fileLabel")}
        prompt={t("cvUpload.drop")}
        hint={t("cvUpload.fileHint")}
        accept={CV_FILE_ACCEPT}
        rules={CV_FILE_RULES}
        problems={{ too_large: errors.too_large, unsupported_format: errors.unsupported_format }}
        reading={
          reading
            ? {
                label: action.step ? t(`aiActivity.steps.${action.step.label}`) : t("cvUpload.reading"),
                activity: action.step?.activity ?? READING,
                stopLabel: t("aiActivity.live.stop.cv_reading"),
                onStop: action.stop,
              }
            : null
        }
        error={state.error ? errors[state.error] : null}
        onChange={(file) => {
          setChosen(Boolean(file));
          setState({});
        }}
      >
        {chosen && !reading ? (
          <div className="actions">
            <button className="button button-primary" type="submit">
              {t("cvUpload.submit")}
            </button>
          </div>
        ) : null}
        {state.stoppedAt ? (
          <p className="notice notice-stopped" role="status">
            {t("cvUpload.stopped", { time: formatTimeOfDay(state.stoppedAt, new Date(), i18n.language === "en" ? "en" : "fr") })}
          </p>
        ) : null}
        {onFromScratch ? (
          <p className="ds-upload__meta">
            {t("cvUpload.noCv")}{" "}
            <button className="link-button" type="button" onClick={onFromScratch}>
              {t("cvUpload.fromScratch")}
            </button>
          </p>
        ) : null}
      </FileUpload>
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
    criteria: criteriaFieldsOf({ targetRole: props.draft.searchCriteria.targetRole, locations: props.draft.searchCriteria.locations }),
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
        // What read the CV, when the AI Coach did (#335): kept with the Master CV's first version.
        body: JSON.stringify({ masterCv, searchCriteria, ...(props.draft.provenance ? { provenance: props.draft.provenance } : {}) }),
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
