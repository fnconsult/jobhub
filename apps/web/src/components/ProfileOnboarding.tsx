"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft } from "@/cv";
import { useWorkPane, type AddressedKind } from "@/components/work-pane";
import { InWorkPane } from "@/components/WorkPane";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import {
  answer,
  currentQuestion,
  draftFromQuestionnaire,
  startQuestionnaire,
  type AnswerError,
  type Question,
  type Questionnaire,
} from "@/questionnaire";
import { routes } from "@/routes";
import { BLANK_DRAFT, CvReview, CvUpload, type ReviewEdits } from "./CvDraftForms";
import "./QuickActions.css";

type From = "cv" | "questionnaire" | "scratch";
type Step = { kind: "choose" } | { kind: "questionnaire" } | { kind: "review"; draft: CvDraft; from: From };

interface Turn {
  question: Question;
  /** What the Candidate answered, as typed ("" when skipped, "yes"/"no" for a yes-or-no question). */
  value: string;
}

/** Where each draft comes from. */
const FROM_CV: From = "cv";
const FROM_SCRATCH: From = "scratch";

/** The review form in the Work Pane: a form, at the page's own address, the draft living in the page. */
const REVIEW: AddressedKind = "form";
const REVIEW_HREF = `${routes.newProfile}#relecture`;

/**
 * Creating a Profile under « Conversation au centre » (ADR-0070): the page is a conversation with the AI Coach, its
 * thread at its reading width, centred, the box at its foot. The Coach's Introduction offers two paths: uploading a CV,
 * a card in the thread (« Partir de zéro » under its drop zone, #468), or answering the Onboarding Questionnaire, the
 * suggestion above the box. The Questionnaire is scripted, so it cannot invent facts: one question at a time in the
 * thread, answered in the box, a yes-or-no question by its suggestions. Either path gives the same draft Master CV and
 * Search Criteria, reviewed in the Work Pane before anything is saved; what the Candidate changed there is kept while the
 * pane is closed, and « Relire et enregistrer » opens it again. No AI replies here, so nothing is stored as a Coach
 * Conversation.
 */
export function ProfileOnboarding() {
  const { t } = useTranslation();
  const id = useId();
  const pane = useWorkPane();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(startQuestionnaire);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [error, setError] = useState<AnswerError | null>(null);
  // Each opening of the review mounts it afresh in the Work Pane; what was changed in it is kept here meanwhile.
  const [reviewOpening, setReviewOpening] = useState(0);
  const [edits, setEdits] = useState<ReviewEdits | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const question = step.kind === "questionnaire" ? currentQuestion(questionnaire) : null;
  const reviewShown = pane?.item?.kind === REVIEW && pane.item.href === REVIEW_HREF;

  // The next question takes the focus: the box, or a yes-or-no question's first answer.
  useEffect(() => {
    if (step.kind !== "questionnaire") return;
    (box.current ?? firstChoice.current)?.focus();
  }, [step.kind, turns.length]);

  function review(draft: CvDraft, from: From) {
    setEdits(null);
    setStep({ kind: "review", draft, from });
    setReviewOpening((opening) => opening + 1);
  }

  function startOver() {
    setStep({ kind: "choose" });
    setQuestionnaire(startQuestionnaire());
    setTurns([]);
    setValue("");
    setError(null);
    setEdits(null);
  }

  function reply(given: string) {
    if (!question) return;
    const result = answer(questionnaire, given);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTurns([...turns, { question, value: given.trim() }]);
    setQuestionnaire(result.questionnaire);
    setValue("");
    setError(null);
    if (!currentQuestion(result.questionnaire)) review(draftFromQuestionnaire(result.questionnaire), "questionnaire");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reply(value);
  }

  const questionText = (asked: Question) => t(`questionnaire.questions.${asked.id}`, { number: asked.number ?? 1 });
  const answerText = (turn: Turn) =>
    turn.question.kind === "yesNo" ? t(turn.value === "yes" ? "questionnaire.yes" : "questionnaire.no") : turn.value || t("questionnaire.skipped");
  const reviewIntro: Record<From, string> = { cv: t("cvReview.intro"), questionnaire: t("questionnaire.reviewIntro"), scratch: t("cvReview.scratchIntro") };
  const startOverLabel = step.kind === "review" && step.from === "questionnaire" ? t("questionnaire.startOver") : t("cvReview.startOver");
  const answering = step.kind === "questionnaire" || (step.kind === "review" && step.from === "questionnaire");
  const described = [question?.optional ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <section className="page-conversation" aria-label={t("newProfile.conversation")}>
        <div className="page-conversation-thread">
          <ol className="chat" aria-label={t("questionnaire.transcript")} aria-live="polite">
            <CoachLine>
              <p>{t("newProfile.intro")}</p>
              <p>{t("newProfile.withoutCvIntro")}</p>
            </CoachLine>
            {step.kind === "choose" ? (
              <li className="chat-message chat-card">
                <Card title={t("newProfile.withCv")}>
                  <p>{t("cvUpload.intro")}</p>
                  <CvUpload onDraft={(draft) => review(draft, FROM_CV)} onFromScratch={() => review(BLANK_DRAFT, FROM_SCRATCH)} />
                </Card>
              </li>
            ) : null}
            {answering ? (
              <>
                <li className="chat-message chat-candidate">
                  <span className="visually-hidden">{t("questionnaire.you")}</span>
                  <p>{t("newProfile.startQuestionnaire")}</p>
                </li>
                <CoachLine>
                  <p>{t("questionnaire.welcome")}</p>
                </CoachLine>
                {turns.flatMap((turn, index) => [
                  <CoachLine key={`question-${index}`}>
                    <p>{questionText(turn.question)}</p>
                  </CoachLine>,
                  <li key={`answer-${index}`} className="chat-message chat-candidate">
                    <span className="visually-hidden">{t("questionnaire.you")}</span>
                    <p>{answerText(turn)}</p>
                  </li>,
                ])}
              </>
            ) : null}
            {question ? (
              <CoachLine>
                <p>{questionText(question)}</p>
              </CoachLine>
            ) : null}
            {step.kind === "review" ? (
              <CoachLine>
                <p>{reviewIntro[step.from]}</p>
              </CoachLine>
            ) : null}
          </ol>
        </div>
        <div className="page-conversation-foot">
          {step.kind === "choose" ? (
            <Suggestions label={t("conversationFirst.suggestions")}>
              <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => setStep({ kind: "questionnaire" })}>
                {t("newProfile.startQuestionnaire")}
              </button>
            </Suggestions>
          ) : null}
          {step.kind === "review" && !reviewShown ? (
            <Suggestions label={t("conversationFirst.suggestions")}>
              <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => setReviewOpening((opening) => opening + 1)}>
                {t("newProfile.openReview")}
              </button>
              <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={startOver}>
                {startOverLabel}
              </button>
            </Suggestions>
          ) : null}
          {question?.kind === "yesNo" ? (
            <Suggestions label={t("questionnaire.answerLabel")}>
              <button ref={firstChoice} className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={() => reply("yes")}>
                {t("questionnaire.yes")}
              </button>
              <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={() => reply("no")}>
                {t("questionnaire.no")}
              </button>
            </Suggestions>
          ) : question ? (
            <>
              {question.optional ? (
                <Suggestions label={t("conversationFirst.suggestions")}>
                  <button className={buttonClass({ variant: "secondary", size: "sm" })} type="button" onClick={() => reply("")}>
                    {t("questionnaire.skip")}
                  </button>
                </Suggestions>
              ) : null}
              <form className="coach-panel-form" onSubmit={submit} noValidate>
                <label className="visually-hidden" htmlFor={id}>
                  {t("questionnaire.answerLabel")}
                </label>
                {question.optional ? (
                  <p id={`${id}-hint`} className="hint">
                    {t("questionnaire.answerHint")}
                  </p>
                ) : null}
                {error ? (
                  <p id={`${id}-error`} className="field-error" role="alert">
                    {t(`questionnaire.errors.${error}`)}
                  </p>
                ) : null}
                {/* The Send button sits inside the box; a click anywhere in the box writes in it. */}
                <div className="coach-panel-composer" onClick={(event) => event.target === event.currentTarget && box.current?.focus()}>
                  <textarea
                    id={id}
                    ref={box}
                    rows={question.kind === "multiline" ? 4 : 2}
                    placeholder={t("questionnaire.answerLabel")}
                    value={value}
                    required={!question.optional}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={described}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter answers, as in the conversation's box; Shift+Enter starts a new line.
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="coach-panel-composer-actions">
                    <button className={buttonClass({ variant: "primary" })} type="submit">
                      {t("questionnaire.send")}
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : null}
        </div>
      </section>
      {step.kind === "review" ? (
        <InWorkPane key={reviewOpening} kind={REVIEW} title={t("cvReview.title")} href={REVIEW_HREF} back={routes.newProfile}>
          <CvReview draft={step.draft} {...(edits ? { kept: edits } : {})} onKeep={setEdits} startOverLabel={startOverLabel} onStartOver={startOver} />
        </InWorkPane>
      ) : null}
    </>
  );
}

/** One of the AI Coach's lines in the thread: unframed text, its author heard by screen readers only (#317). */
function CoachLine({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach">
      <span className="visually-hidden">{t("questionnaire.coach")}</span>
      {children}
    </li>
  );
}

/** Suggestions above the box, as on every page that is a conversation. */
function Suggestions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="page-conversation-suggestions" role="group" aria-label={label}>
      <div className="quick-actions">{children}</div>
    </div>
  );
}
