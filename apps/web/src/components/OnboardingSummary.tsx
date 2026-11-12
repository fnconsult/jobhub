"use client";

import { MAX_SEARCH_LOCATIONS, type Provenance, type SearchCriteria } from "@jobhub/shared";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { profileSummary, summaryText } from "@jobhub/shared/profile-summary";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft } from "@/cv";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Pill } from "@/design/Pill";
import { changedCriteria, changeWords, criteriaChanges, type CriteriaChange } from "@/onboarding-summary/changes";
import { useAiActivityLive } from "./AiActivityLive";
import { saveReviewedProfile, type BornProfile, type ReviewEdits, type SaveRefusal } from "./CvDraftForms";
import { Icons } from "./icons";
import { useIndustryReference } from "./IndustryInputs";
import { criteriaFieldsOf, useSearchCriteriaLabels, type CriteriaFields } from "./SearchCriteriaFields";
import { UpgradePrompt } from "./UpgradePrompt";
import "./ProfileOnboarding.css";

/** What the card says after « Modifier »'s text was read, or why nothing changed (#1005). */
type Notice = "applied" | "unchanged" | "other" | "unusable" | "tooManyPlaces";

/**
 * The card's mode: reading the summary; « Modifier »'s text box (`editing`); the text sent to the AI (`understanding`);
 * the changes it understood, for the Candidate to validate (`proposed`).
 */
type Mode =
  | { kind: "reading"; notice?: Notice }
  | { kind: "editing"; text: string }
  | { kind: "understanding"; text: string }
  | { kind: "proposed"; changes: CriteriaChange[]; next: SearchCriteria; other: boolean };

/**
 * The end of the onboarding (#1004, ADR-0106): « Presque fini », « Voici comment je comprends ce que vous recherchez. Ai-je
 * bien compris ? », and the card « Votre recherche d'offres », a paragraph composed by Jobbbox from the review's draft, as
 * changed in the review form (`edits`): no AI writes it (`profileSummary`). « Cela semble correct » saves it as the review
 * form's « Enregistrer mon profil » does, then the coach says it is saved; « Voir le détail » opens the review form in the
 * Work Pane, and what is changed there shows here.
 *
 * « Modifier » (#1005) puts the card in « Modification »: the summary as plain text in a text box, to rewrite as the
 * Candidate would tell a recruiter. « Annuler » changes nothing. « Terminé » sends it to the AI Coach
 * (`POST /api/onboarding/summary-changes`), which translates it into Search Criteria changes, shown for validation (« J'ai
 * compris : + CDD, − Lyon, + Paris »); once validated they are made in the review's draft (`onEdits`, saved with the
 * rest by « Cela semble correct »), and the summary, composed again, asks again. The text itself is kept nowhere. What
 * is not a Search Criterion (a skill, a job held) is sent to « Voir le détail »; a reply the AI could not give leaves the
 * summary as it was, and says so. The step shows in « Création du profil » with its model and tokens.
 * Items of the thread (`li`), for its `ol`.
 */
export function OnboardingSummary({
  draft,
  edits,
  born,
  onDetail,
  onEdits,
  onSaved,
}: {
  draft: CvDraft;
  /** What the Candidate changed in the review form, when they opened it. */
  edits: ReviewEdits | null;
  born: () => Promise<BornProfile | null>;
  /** Opens the review form in the Work Pane. */
  onDetail: () => void;
  /** The draft as changed by « Modifier »'s validated changes (#1005), as the review form keeps its own. */
  onEdits: (edits: ReviewEdits) => void;
  /** The Profile saved, at its page's address. */
  onSaved: (href: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const noteCreation = useAiActivityLive()?.noteCreation;
  const industries = useIndustryReference();
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "reading" });
  const toProfile = useRef<HTMLAnchorElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const fieldLabels = useSearchCriteriaLabels();
  const headingId = useId();
  const textId = useId();

  const language = isSupportedLocale(i18n.language) ? i18n.language : "fr";
  const reviewed: ReviewEdits = edits ?? { masterCv: draft.masterCv, criteria: criteriaFieldsOf(draft.searchCriteria) };
  const parts = profileSummary({ searchCriteria: summaryCriteria(reviewed.criteria), masterCv: reviewed.masterCv }, { locale: language });

  // Saved: the button is gone, the focus goes to where the Candidate goes next.
  useEffect(() => {
    if (savedAt) toProfile.current?.focus();
  }, [savedAt]);

  // « Modifier » puts the focus in the text box; « Annuler » back on « Modifier ».
  const focusEdit = useRef(false);
  const editing = mode.kind === "editing";
  useEffect(() => {
    if (editing) textBox.current?.focus();
    else if (focusEdit.current && editButton.current) {
      focusEdit.current = false;
      editButton.current.focus();
    }
  }, [editing, mode.kind]);

  function cancel() {
    focusEdit.current = true;
    setMode({ kind: "reading" });
  }

  /** « Terminé »: the text read by the AI; the same text as the summary changes nothing, and asks no AI. */
  async function understand(text: string) {
    if (text.trim() === "" || text.trim() === summaryText(parts).trim()) return setMode({ kind: "reading", notice: "unchanged" });
    setMode({ kind: "understanding", text });
    const criteria = sentCriteria(reviewed.criteria);
    let status = 0;
    let body: { searchCriteria?: SearchCriteria; other?: boolean; error?: string; provenance?: Provenance | null } = {};
    try {
      const response = await fetch("/api/onboarding/summary-changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ criteria, summaryText: summaryText(parts), rewritten: text }),
      });
      status = response.status;
      body = await response.json().catch(() => ({}));
    } catch {
      // Unreachable: as an AI that could not answer.
    }
    if (status === 200 || body.provenance !== undefined) noteCreation?.({ type: "summaryChanged", provenance: body.provenance ?? null });
    if (status !== 200 || !body.searchCriteria) return setMode({ kind: "reading", notice: body.error === "too_many_locations" ? "tooManyPlaces" : "unusable" });
    const changes = criteriaChanges(criteria, body.searchCriteria);
    if (changes.length === 0) return setMode({ kind: "reading", notice: body.other ? "other" : "unchanged" });
    setMode({ kind: "proposed", changes, next: body.searchCriteria, other: Boolean(body.other) });
  }

  /** The changes validated: made in the draft, only the criteria they touch; the summary is composed again. */
  function validate(changes: readonly CriteriaChange[], next: SearchCriteria) {
    const nextFields = criteriaFieldsOf(next);
    const criteria: CriteriaFields = { ...reviewed.criteria };
    for (const criterion of changedCriteria(changes)) Object.assign(criteria, { [criterion]: nextFields[criterion] });
    onEdits({ masterCv: reviewed.masterCv, criteria });
    setMode({ kind: "reading", notice: "applied" });
  }

  async function confirm() {
    setSaving(true);
    setRefusal(null);
    const outcome = await saveReviewedProfile({ draft, edits: reviewed, born });
    setSaving(false);
    if (!outcome.ok) return setRefusal(outcome.refusal);
    onSaved(outcome.href);
    setSavedAt(outcome.href);
  }

  const invalidFields = [...new Set((refusal?.errors ?? []).map((error) => fieldLabels[error.field] ?? error.field))];

  return (
    <>
      <CoachLine>
        <p className="onb-badge-line">
          <Pill tone="accent">
            <Icons.nouveautes />
            {t("onboardingSummary.badge")}
          </Pill>
        </p>
        <p>{t("onboardingSummary.question")}</p>
      </CoachLine>
      <li className="chat-message chat-card onb-summary-card">
        <Card
          title={t("onboardingSummary.title")}
          headingLevel={3}
          headingId={headingId}
          actions={mode.kind === "editing" || mode.kind === "understanding" ? <Pill tone="warn">{t("onboardingSummary.editing")}</Pill> : null}
        >
          {mode.kind === "editing" || mode.kind === "understanding" ? (
            <form
              className="ds-field onb-edit"
              onSubmit={(event) => {
                event.preventDefault();
                if (mode.kind === "editing") void understand(mode.text);
              }}
            >
              <label className="visually-hidden" htmlFor={textId}>
                {t("onboardingSummary.editLabel")}
              </label>
              <p id={`${textId}-hint`} className="ds-field__hint">
                {t("onboardingSummary.editHint")}
              </p>
              <textarea
                id={textId}
                ref={textBox}
                className="ds-input ds-textarea onb-textarea"
                rows={7}
                aria-describedby={`${textId}-hint`}
                value={mode.text}
                readOnly={mode.kind === "understanding"}
                onChange={(event) => setMode({ kind: "editing", text: event.target.value })}
              />
              {mode.kind === "understanding" ? (
                <p className="onb-understanding" role="status">
                  {t("onboardingSummary.understanding")}
                </p>
              ) : (
                <div className="onb-actions">
                  <button className={buttonClass({ variant: "secondary" })} type="button" onClick={cancel}>
                    {t("onboardingSummary.cancel")}
                  </button>
                  <button className={buttonClass({ variant: "primary" })} type="submit">
                    {t("onboardingSummary.done")}
                  </button>
                </div>
              )}
            </form>
          ) : parts.length > 0 ? (
            <p className="onb-summary">
              {parts.map((part, index) => (part.strong ? <strong key={index}>{part.text}</strong> : part.text))}
            </p>
          ) : (
            <p className="onb-summary-empty">{t("onboardingSummary.empty")}</p>
          )}
          {mode.kind === "proposed" ? (
            <div className="onb-understood" role="status">
              <p>{t("onboardingSummary.understood", { changes: mode.changes.map((change) => changeWords(change, { t: t as never, language, industries })).join(", ") })}</p>
              {mode.other ? <p>{t("onboardingSummary.other")}</p> : null}
            </div>
          ) : null}
          {mode.kind === "reading" && mode.notice ? (
            <p className={mode.notice === "unusable" || mode.notice === "tooManyPlaces" ? "notice notice-failed" : "notice"} role="status">
              {t(`onboardingSummary.notices.${mode.notice}`, { max: MAX_SEARCH_LOCATIONS })}
            </p>
          ) : null}
          {invalidFields.length > 0 ? (
            <p className="notice" role="alert">
              {t("onboardingSummary.invalid", { fields: invalidFields.join(", ") })}
            </p>
          ) : null}
          {refusal?.upgradePrompt ? (
            <UpgradePrompt prompt={refusal.upgradePrompt} />
          ) : refusal?.quotaReached ? (
            <p className="notice" role="alert">
              {t("profiles.quotaReached")}
            </p>
          ) : null}
          {refusal?.failed ? (
            <p className="notice" role="alert">
              {t("cvReview.error")}
            </p>
          ) : null}
          {mode.kind === "proposed" ? (
            <div className="onb-actions">
              {mode.other ? (
                <button className="link-button onb-detail-link" type="button" onClick={onDetail}>
                  {t("onboardingSummary.detail")}
                </button>
              ) : null}
              <span className="onb-actions-buttons">
                <button className={buttonClass({ variant: "secondary" })} type="button" onClick={cancel}>
                  {t("onboardingSummary.cancel")}
                </button>
                <button className={buttonClass({ variant: "primary" })} type="button" onClick={() => validate(mode.changes, mode.next)}>
                  <Icons.done />
                  {t("onboardingSummary.validate")}
                </button>
              </span>
            </div>
          ) : null}
          {savedAt || mode.kind !== "reading" ? null : (
            <div className="onb-actions">
              <button className="link-button onb-detail-link" type="button" onClick={onDetail}>
                {t("onboardingSummary.detail")}
              </button>
              <span className="onb-actions-buttons">
                <button ref={editButton} className={buttonClass({ variant: "secondary" })} type="button" onClick={() => setMode({ kind: "editing", text: summaryText(parts) })}>
                  {t("onboardingSummary.edit")}
                </button>
                <button className={buttonClass({ variant: "primary" })} type="button" onClick={confirm} disabled={saving}>
                  <Icons.done />
                  {saving ? t("onboardingSummary.confirming") : t("onboardingSummary.confirm")}
                </button>
              </span>
            </div>
          )}
        </Card>
      </li>
      {savedAt ? (
        <>
          <li className="chat-message chat-candidate">
            <span className="visually-hidden">{t("questionnaire.you")}</span>
            <p>{t("onboardingSummary.confirm")}</p>
          </li>
          <CoachLine>
            <p>{t("onboardingSummary.saved")}</p>
            <p>
              <Link ref={toProfile} className={buttonClass({ variant: "primary" })} href={savedAt}>
                {t("onboardingSummary.toProfile")}
              </Link>
            </p>
          </CoachLine>
        </>
      ) : null}
    </>
  );
}

/** The Search Criteria the review form shows, as the summary reads them: a salary only when it is a whole number. */
function summaryCriteria(criteria: CriteriaFields): Partial<SearchCriteria> {
  const salary = criteria.minSalary.replace(/[\s.]/g, "");
  return {
    targetRole: criteria.targetRole,
    locations: criteria.locations,
    contractTypes: criteria.contractTypes,
    remoteWorkOptions: criteria.remoteWorkOptions,
    ...(/^\d+$/.test(salary) ? { minSalary: Number(salary) } : {}),
  };
}

/**
 * The Search Criteria sent with « Modifier »'s text (#1005): the summary's, with the Sectors and Domains (not in the
 * summary, but a change the AI may find), a salary only when it is above nothing.
 */
function sentCriteria(criteria: CriteriaFields): Partial<SearchCriteria> {
  const { minSalary, ...shown } = summaryCriteria(criteria);
  return {
    ...shown,
    ...(minSalary ? { minSalary } : {}),
    sectors: criteria.sectors,
    subsectors: criteria.subsectors,
    domains: criteria.domains,
  };
}

/** One of the AI Coach's lines in the thread, as ProfileOnboarding writes them: its author heard by screen readers only. */
function CoachLine({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach">
      <span className="visually-hidden">{t("questionnaire.coach")}</span>
      {children}
    </li>
  );
}
