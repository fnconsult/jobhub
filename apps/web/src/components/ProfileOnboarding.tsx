"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft } from "@/cv";
import { BLANK_DRAFT, CvReview, CvUpload } from "./CvDraftForms";
import { OnboardingQuestionnaire } from "./OnboardingQuestionnaire";

type Step = { kind: "choose" } | { kind: "questionnaire" } | { kind: "review"; draft: CvDraft; from: "cv" | "questionnaire" | "scratch" };

/**
 * Creating a Profile, by either of two paths: uploading a CV, or answering the
 * AI Coach's Onboarding Questionnaire. Both give the same draft Master CV and
 * Search Criteria, which the Candidate reviews before anything is saved. A
 * Candidate without a CV can also start from scratch, on the review form left blank.
 */
export function ProfileOnboarding() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const startOver = () => setStep({ kind: "choose" });
  const reviewCv = (draft: CvDraft) => setStep({ kind: "review", draft, from: "cv" });
  const reviewAnswers = (draft: CvDraft) => setStep({ kind: "review", draft, from: "questionnaire" });
  const startFromScratch = () => setStep({ kind: "review", draft: BLANK_DRAFT, from: "scratch" });
  const intro = { cv: t("cvReview.intro"), questionnaire: t("questionnaire.reviewIntro"), scratch: t("cvReview.scratchIntro") };

  if (step.kind === "review") {
    return (
      <CvReview
        draft={step.draft}
        intro={intro[step.from]}
        startOverLabel={step.from === "questionnaire" ? t("questionnaire.startOver") : t("cvReview.startOver")}
        onStartOver={startOver}
      />
    );
  }
  if (step.kind === "questionnaire") {
    return <OnboardingQuestionnaire onDone={reviewAnswers} />;
  }
  return (
    <>
      <section className="onboarding-path">
        <h2>{t("newProfile.withCv")}</h2>
        <p>{t("cvUpload.intro")}</p>
        <CvUpload onDraft={reviewCv} />
      </section>
      <section className="onboarding-path">
        <h2>{t("newProfile.withoutCv")}</h2>
        <p>{t("newProfile.withoutCvIntro")}</p>
        <button className="button button-primary" type="button" onClick={() => setStep({ kind: "questionnaire" })}>
          {t("newProfile.startQuestionnaire")}
        </button>
        <p>{t("cvUpload.fromScratchHint")}</p>
        <button className="button" type="button" onClick={startFromScratch}>
          {t("cvUpload.fromScratch")}
        </button>
      </section>
    </>
  );
}
