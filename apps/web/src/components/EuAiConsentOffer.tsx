"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { HelpText } from "./HelpTerm";
import { CoachLine } from "./CoachLine";

/** What the Candidate answered when the EU AI Consent was proposed: given, or « Pas maintenant ». */
export type EuAiConsentAnswer = "given" | "notNow";

/**
 * The EU AI Consent proposed before a CV is read (#1052): `beforeReading` holds the reading until the Candidate answers,
 * and lets it go at once when they had consented before or already answered during this onboarding. Given, it is the same
 * dated consent as Mon compte › IA européenne's (`PUT /api/account/eu-ai-consent`), recorded before the CV leaves, so
 * that its reading goes the EU AI Consent's way; « Pas maintenant » records nothing, and the CV is read after Redaction.
 */
export interface EuAiConsentOffer {
  /** Proposed, waiting for the Candidate's answer. */
  asking: boolean;
  /** Proposed during this onboarding (the thread shows the question), and what was answered once answered. */
  asked: { answer: EuAiConsentAnswer | null } | null;
  /** The consent being recorded. */
  working: boolean;
  /** The consent could not be recorded: nothing read, both choices still offered. */
  failed: boolean;
  /** Resolves once the CV may leave for the AI. */
  beforeReading: () => Promise<void>;
  give: () => Promise<void>;
  notNow: () => void;
  /** The thread starts over (« Recommencer »): the question leaves it, the answer is kept. */
  forget: () => void;
}

const CONSENT_URL = "/api/account/eu-ai-consent";

/** The EU AI Consent to propose before reading a CV; `givenBefore`: the Candidate had consented, so it is never proposed. */
export function useEuAiConsentOffer(givenBefore: boolean): EuAiConsentOffer {
  // Consented before, or answered during this onboarding: never proposed again.
  const settled = useRef(givenBefore);
  const waiting = useRef<(() => void) | null>(null);
  const [asked, setAsked] = useState<EuAiConsentOffer["asked"]>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  function settle(answer: EuAiConsentAnswer) {
    settled.current = true;
    setFailed(false);
    setAsked({ answer });
    const go = waiting.current;
    waiting.current = null;
    go?.();
  }

  return {
    asking: asked !== null && asked.answer === null,
    asked,
    working,
    failed,
    beforeReading() {
      if (settled.current) return Promise.resolve();
      setAsked({ answer: null });
      return new Promise<void>((resolve) => {
        waiting.current = resolve;
      });
    },
    async give() {
      setWorking(true);
      setFailed(false);
      try {
        const response = await fetch(CONSENT_URL, { method: "PUT" });
        if (!response.ok) throw new Error(String(response.status));
        settle("given");
      } catch {
        setFailed(true);
      } finally {
        setWorking(false);
      }
    },
    notNow() {
      settle("notNow");
    },
    forget() {
      if (waiting.current) return;
      setAsked(null);
    },
  };
}

/**
 * The question in the thread: one line of the coach, the sentence Mon compte › IA européenne's validated text starts
 * with, word for word (no new wording, #1052), « votre accord » opening its glossary article; then the Candidate's answer.
 * Asked, the line is brought into view, so that it is read before the choice (on a phone, the CV's card pushes it under the
 * box).
 */
export function EuAiConsentQuestion({ offer }: { offer: EuAiConsentOffer }) {
  const { t } = useTranslation();
  const line = useRef<HTMLParagraphElement>(null);
  const { asking } = offer;
  useEffect(() => {
    if (asking) line.current?.scrollIntoView?.({ block: "center" });
  }, [asking]);
  if (!offer.asked) return null;
  const { answer } = offer.asked;
  return (
    <>
      <CoachLine>
        <p ref={line}>
          <HelpText terms={{ euAiConsent: t("helpTerms.words.euAiConsent") }}>{t("euAiConsent.offer")}</HelpText>
        </p>
      </CoachLine>
      {offer.failed ? (
        <li className="chat-message chat-card">
          <Note tone="danger" role="alert">
            {t("euAiConsent.error")}
          </Note>
        </li>
      ) : null}
      {answer ? (
        <li className="chat-message chat-candidate">
          <span className="visually-hidden">{t("questionnaire.you")}</span>
          <p>{answer === "given" ? t("euAiConsent.give") : t("euAiConsent.notNow")}</p>
        </li>
      ) : null}
    </>
  );
}

/**
 * Its two answers, of the same weight: the same look, side by side, neither pre-selected nor focused for the Candidate.
 * Rendered in the page's suggestions above the box, as every choice of the thread.
 */
export function EuAiConsentChoices({ offer }: { offer: EuAiConsentOffer }) {
  const { t } = useTranslation();
  const className = buttonClass({ variant: "secondary", size: "sm" });
  return (
    <>
      <button className={className} type="button" disabled={offer.working} onClick={() => void offer.give()}>
        {t("euAiConsent.give")}
      </button>
      <button className={className} type="button" disabled={offer.working} onClick={offer.notNow}>
        {t("euAiConsent.notNow")}
      </button>
    </>
  );
}
