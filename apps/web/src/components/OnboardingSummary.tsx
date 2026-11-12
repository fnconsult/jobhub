"use client";

import type { SearchCriteria } from "@jobhub/shared";
import { isSupportedLocale } from "@jobhub/shared/i18n";
import { profileSummary } from "@jobhub/shared/profile-summary";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft } from "@/cv";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Pill } from "@/design/Pill";
import { saveReviewedProfile, type BornProfile, type ReviewEdits, type SaveRefusal } from "./CvDraftForms";
import { Icons } from "./icons";
import { criteriaFieldsOf, useSearchCriteriaLabels, type CriteriaFields } from "./SearchCriteriaFields";
import { UpgradePrompt } from "./UpgradePrompt";
import "./ProfileOnboarding.css";

/**
 * The end of the onboarding (#1004, ADR-0106): « Presque fini », « Voici comment je comprends ce que vous recherchez. Ai-je
 * bien compris ? », and the card « Votre recherche d'offres », a paragraph composed by Jobbbox from the review's draft, as
 * changed in the review form (`edits`): no AI writes it (`profileSummary`). « Cela semble correct » saves it as the review
 * form's « Enregistrer mon profil » does, then the coach says it is saved; « Voir le détail » opens the review form in the
 * Work Pane, and what is changed there shows here. « Modifier » opens the same form until #1005 lets the Candidate say
 * the change in their own words. Items of the thread (`li`), for its `ol`.
 */
export function OnboardingSummary({
  draft,
  edits,
  born,
  onDetail,
  onSaved,
}: {
  draft: CvDraft;
  /** What the Candidate changed in the review form, when they opened it. */
  edits: ReviewEdits | null;
  born: () => Promise<BornProfile | null>;
  /** Opens the review form in the Work Pane. */
  onDetail: () => void;
  /** The Profile saved, at its page's address. */
  onSaved: (href: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const toProfile = useRef<HTMLAnchorElement>(null);
  const fieldLabels = useSearchCriteriaLabels();
  const headingId = useId();

  const reviewed: ReviewEdits = edits ?? { masterCv: draft.masterCv, criteria: criteriaFieldsOf(draft.searchCriteria) };
  const parts = profileSummary(
    { searchCriteria: summaryCriteria(reviewed.criteria), masterCv: reviewed.masterCv },
    { locale: isSupportedLocale(i18n.language) ? i18n.language : "fr" },
  );

  // Saved: the button is gone, the focus goes to where the Candidate goes next.
  useEffect(() => {
    if (savedAt) toProfile.current?.focus();
  }, [savedAt]);

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
        <Card title={t("onboardingSummary.title")} headingLevel={3} headingId={headingId}>
          {parts.length > 0 ? (
            <p className="onb-summary">
              {parts.map((part, index) => (part.strong ? <strong key={index}>{part.text}</strong> : part.text))}
            </p>
          ) : (
            <p className="onb-summary-empty">{t("onboardingSummary.empty")}</p>
          )}
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
          {savedAt ? null : (
            <div className="onb-actions">
              <button className="link-button onb-detail-link" type="button" onClick={onDetail}>
                {t("onboardingSummary.detail")}
              </button>
              <span className="onb-actions-buttons">
                {/* « Modifier » in the Candidate's own words is #1005: until then it opens the same form. */}
                <button className={buttonClass({ variant: "secondary" })} type="button" onClick={onDetail}>
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
