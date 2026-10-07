"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CvDraft } from "@/cv";
import {
  answer,
  currentQuestion,
  draftFromQuestionnaire,
  startQuestionnaire,
  type AnswerError,
  type Question,
  type Questionnaire,
} from "@/questionnaire";

interface Turn {
  question: Question;
  /** What the Candidate answered, as typed ("" when skipped, "yes"/"no" for a yes-or-no question). */
  value: string;
}

/**
 * The Onboarding Questionnaire as a conversation with the AI Coach: one
 * question at a time, the Candidate's answers shown under each. Hands the
 * finished draft over for review once the last question is answered.
 */
export function OnboardingQuestionnaire({ onDone }: { onDone: (draft: CvDraft) => void }) {
  const { t } = useTranslation();
  const inputId = useId();
  const [questionnaire, setQuestionnaire] = useState<Questionnaire>(startQuestionnaire);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [error, setError] = useState<AnswerError | null>(null);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const question = currentQuestion(questionnaire);

  useEffect(() => {
    input.current?.focus();
  }, [turns.length]);

  const questionText = (asked: Question) => t(`questionnaire.questions.${asked.id}`, { number: asked.number ?? 1 });
  const answerText = (turn: Turn) =>
    turn.question.kind === "yesNo" ? t(turn.value === "yes" ? "questionnaire.yes" : "questionnaire.no") : turn.value || t("questionnaire.skipped");

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
    if (!currentQuestion(result.questionnaire)) onDone(draftFromQuestionnaire(result.questionnaire));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reply(value);
  }

  const described = [question?.optional ? `${inputId}-hint` : "", error ? `${inputId}-error` : ""].filter(Boolean).join(" ") || undefined;

  return (
    <section className="stack questionnaire" aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`}>{t("questionnaire.title")}</h2>
      <ol className="chat" aria-label={t("questionnaire.transcript")} aria-live="polite">
        <CoachLine text={t("questionnaire.welcome")} />
        {turns.flatMap((turn, index) => [
          <CoachLine key={`question-${index}`} text={questionText(turn.question)} />,
          <li key={`answer-${index}`} className="chat-message chat-candidate">
            <span className="chat-author">{t("questionnaire.you")}</span>
            <p>{answerText(turn)}</p>
          </li>,
        ])}
        {question ? <CoachLine text={questionText(question)} /> : null}
      </ol>

      {question?.kind === "yesNo" ? (
        <div className="actions">
          <button className="button button-primary" type="button" onClick={() => reply("yes")}>
            {t("questionnaire.yes")}
          </button>
          <button className="button" type="button" onClick={() => reply("no")}>
            {t("questionnaire.no")}
          </button>
        </div>
      ) : question ? (
        <form className="stack chat-form" onSubmit={submit} noValidate>
          <label htmlFor={inputId}>{t("questionnaire.answerLabel")}</label>
          {question.optional ? (
            <p id={`${inputId}-hint`} className="hint">
              {t("questionnaire.answerHint")}
            </p>
          ) : null}
          {question.kind === "multiline" ? (
            <textarea
              id={inputId}
              ref={input}
              className="input"
              rows={4}
              value={value}
              aria-invalid={error ? true : undefined}
              aria-describedby={described}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <input
              id={inputId}
              ref={input}
              className="input"
              type="text"
              value={value}
              required={!question.optional}
              aria-invalid={error ? true : undefined}
              aria-describedby={described}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          {error ? (
            <p id={`${inputId}-error`} className="field-error" role="alert">
              {t(`questionnaire.errors.${error}`)}
            </p>
          ) : null}
          <div className="actions">
            <button className="button button-primary" type="submit">
              {t("questionnaire.send")}
            </button>
            {question.optional ? (
              <button className="button" type="button" onClick={() => reply("")}>
                {t("questionnaire.skip")}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

function CoachLine({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <li className="chat-message chat-coach">
      <span className="chat-author">{t("questionnaire.coach")}</span>
      <p>{text}</p>
    </li>
  );
}
