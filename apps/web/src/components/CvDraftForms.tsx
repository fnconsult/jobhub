"use client";

import { formatTimeOfDay, type Activity, type MasterCvContent } from "@jobhub/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import type { CvDraft, CvFileErrorCode } from "@/cv";
import { MAX_CV_FILE_BYTES } from "@/cv/limits";
import { FileUpload } from "@/design/FileUpload";
import type { ProfileFieldError, ProfileOnboarding } from "@/profiles";
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

const JSON_BODY = { "content-type": "application/json" };
/** A Profile created at the review's save is created with its onboarding done (#999). */
const ONBOARDING_DONE: ProfileOnboarding = "done";

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
 * Candidate starts from scratch (`onFromScratch`). `onReading` hears the reading start and end.
 */
export function CvUpload({
  onDraft,
  onFromScratch,
  onReading,
}: {
  onDraft: (draft: CvDraft) => void;
  onFromScratch?: () => void;
  /** Told when the reading starts and when it ends (read, stopped or failed): « Profil en construction » follows it (#1003). */
  onReading?: (reading: boolean) => void;
}) {
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
    onReading?.(true);
    const outcome = await action.run("/api/cv/draft", { method: "POST", body: form });
    onReading?.(false);
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

/** What the Candidate changed in the review form, kept by the page while the Work Pane is closed. */
export type ReviewEdits = { masterCv: MasterCvContent; criteria: CriteriaFields };

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

/** A Profile born during its onboarding (ADR-0106, #999): the review finishes it rather than creating one. */
export interface BornProfile {
  id: string;
  /** The version of its Master CV the review's save is based on. */
  version: number;
}

/** Why a reviewed draft was not saved: its field errors, the Plan Quota (with its Upgrade Prompt), or a failure. */
export interface SaveRefusal {
  errors: ProfileFieldError[];
  failed: boolean;
  quotaReached: boolean;
  upgradePrompt: Prompt | null;
}

/** A reviewed draft saved, at its Profile's page, or refused. */
export type SaveOutcome = { ok: true; href: string } | { ok: false; refusal: SaveRefusal };

/**
 * Saving a reviewed draft (`edits`, what the review shows), as the review form's « Enregistrer mon profil » and the
 * summary's « Cela semble correct » (#1004) both do. When the Profile was born during the onboarding (`born`, #999), its
 * Search Criteria are changed as on its page, then one Master CV Version finishes it; otherwise the Profile is created,
 * its onboarding done.
 */
export async function saveReviewedProfile({
  draft,
  edits,
  born: bornProfile,
}: {
  draft: CvDraft;
  edits: ReviewEdits;
  born?: () => Promise<BornProfile | null>;
}): Promise<SaveOutcome> {
  const { masterCv } = edits;
  const searchCriteria = searchCriteriaInput(edits.criteria);
  const saved = (id: string): SaveOutcome => ({ ok: true, href: routes.profile(id) });
  const refused = (body: { errors?: unknown }): SaveOutcome => ({
    ok: false,
    refusal: { errors: Array.isArray(body.errors) ? body.errors : [], failed: !Array.isArray(body.errors), quotaReached: false, upgradePrompt: null },
  });
  try {
    const born = (await bornProfile?.()) ?? null;
    if (born) {
      // Born during the onboarding (#999): its Search Criteria changed as on its page, then one Master CV Version.
      const changed = await fetch(`/api/profiles/${born.id}`, { method: "PATCH", headers: JSON_BODY, body: JSON.stringify({ searchCriteria }) });
      if (!changed.ok) return refused(await changed.json().catch(() => ({})));
      const finished = await fetch(`/api/profiles/${born.id}/onboarding`, {
        method: "POST",
        headers: JSON_BODY,
        body: JSON.stringify({ masterCv, basedOnVersion: born.version }),
      });
      if (finished.ok) return saved(born.id);
      return refused(await finished.json().catch(() => ({})));
    }
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: JSON_BODY,
      // What read the CV, when the AI Coach did (#335): kept with the Master CV's first version.
      body: JSON.stringify({ masterCv, searchCriteria, onboarding: ONBOARDING_DONE, ...(draft.provenance ? { provenance: draft.provenance } : {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 201) return saved(body.id);
    const quotaReached = body.error === "plan_quota_reached";
    return {
      ok: false,
      refusal: {
        errors: Array.isArray(body.errors) ? body.errors : [],
        failed: !Array.isArray(body.errors) && !quotaReached,
        quotaReached,
        upgradePrompt: quotaReached ? upgradePromptIn(body) : null,
      },
    };
  } catch {
    return { ok: false, refusal: { errors: [], failed: true, quotaReached: false, upgradePrompt: null } };
  }
}

/**
 * Reviewing a draft Master CV and Search Criteria, whether read from an uploaded
 * CV, built by the Onboarding Questionnaire or left blank to start from scratch,
 * then saving it as a Profile. Opened in the Work Pane, which titles it (ADR-0070): it starts from `kept`, what was
 * changed before the pane last closed, and hands each change to `onKeep`. When the Profile was born during the
 * onboarding (`born`, #999), the save changes its Search Criteria and finishes it with one Master CV Version; otherwise it
 * creates the Profile, its onboarding done.
 */
export function CvReview(props: {
  draft: CvDraft;
  kept?: ReviewEdits;
  onKeep?: (edits: ReviewEdits) => void;
  startOverLabel: string;
  onStartOver: () => void;
  /** The Profile born during the onboarding, once its creation has answered; null when there is none. */
  born?: () => Promise<BornProfile | null>;
  /** The Profile saved, at its page, just before the Candidate is taken there. */
  onSaved?: (href: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [review, setReview] = useState<ReviewState>(() => ({
    masterCv: props.kept?.masterCv ?? props.draft.masterCv,
    // The whole Search Criteria the draft holds: a resumed Profile's contracts, salary… as well as its role and places.
    criteria: props.kept?.criteria ?? criteriaFieldsOf(props.draft.searchCriteria),
    saving: false,
    errors: [],
    failed: false,
    quotaReached: false,
    upgradePrompt: null,
  }));
  const update = (changes: Partial<ReviewState>) => setReview((current) => ({ ...current, ...changes }));
  const { onKeep } = props;
  useEffect(() => {
    onKeep?.({ masterCv: review.masterCv, criteria: review.criteria });
  }, [onKeep, review.masterCv, review.criteria]);
  const setCriteria = (changes: Partial<CriteriaFields>) => setReview((current) => ({ ...current, criteria: { ...current.criteria, ...changes } }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ saving: true, failed: false, quotaReached: false, upgradePrompt: null, errors: [] });
    const outcome = await saveReviewedProfile({ draft: props.draft, edits: review, ...(props.born ? { born: props.born } : {}) });
    if (!outcome.ok) return update({ saving: false, ...outcome.refusal });
    props.onSaved?.(outcome.href);
    router.push(outcome.href);
  }

  const fieldLabels = useSearchCriteriaLabels();
  const invalidFields = [...new Set(review.errors.map((error) => fieldLabels[error.field] ?? error.field))];

  return (
    <form className="stack review" onSubmit={save} noValidate>
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
