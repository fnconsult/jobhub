"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { CoachReplyText } from "@/components/CoachReplyText";
import { helpForUnanswered, oftenAsked, onThisPage, type HelpArticle, type HelpLocale } from "@/coach-help";

/**
 * The help in the Coach Panel's single box (#342, ADR-0035): Help Articles, written by the Jobbbox team and found
 * without AI. Every part carries `data-help`, so Escape there brings the Candidate back to the message box.
 */

/**
 * « Dans l'aide, sans IA »: the Help Articles matching what the Candidate is typing, above the message box. From the
 * box, ↓ comes here; ↑ and ↓ move from one to the next, Enter opens one, ↑ on the first goes back to the box.
 */
export function HelpSuggestions({ articles, onOpen, onBack }: { articles: readonly HelpArticle[]; onOpen: (article: HelpArticle) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const list = useRef<HTMLUListElement>(null);
  if (articles.length === 0) return null;

  const buttons = () => [...(list.current?.querySelectorAll("button") ?? [])];
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = articles.length - 1;
    const to = event.key === "ArrowDown" ? Math.min(index + 1, last) : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0) onBack();
    else buttons()[to]?.focus();
  }

  return (
    <div className="coach-help-suggestions" data-help>
      <p className="coach-help-suggestions-title" id={titleId}>
        {t("coachPanel.help.suggestions")}
      </p>
      <ul ref={list} aria-labelledby={titleId}>
        {articles.map((article, index) => (
          <li key={article.id}>
            <button type="button" className="coach-help-suggestion" onClick={() => onOpen(article)} onKeyDown={(event) => move(event, index)}>
              <span className="coach-help-suggestion-title">{article.title}</span>
              <span className="coach-help-kind">{t(`coachPanel.help.kinds.${article.kind}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Focuses the first suggestion of the box's list, if there is one: ↓ from the message box. */
export function focusFirstSuggestion(from: HTMLElement): boolean {
  const first = from.closest("form")?.querySelector<HTMLButtonElement>(".coach-help-suggestion");
  first?.focus();
  return !!first;
}

/**
 * A Help Article opened in the conversation, as a card: never saved with the Coach Conversation, never sent to the
 * AI Coach (only its title, if the Candidate then asks). « Non, demander au coach » starts a question about it.
 */
export function HelpArticleCard({
  article,
  headingId,
  answered,
  onAnswered,
  onAskCoach,
}: {
  article: HelpArticle;
  headingId: string;
  answered: boolean;
  onAnswered: () => void;
  onAskCoach: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="help-card" aria-labelledby={headingId} data-help>
      <p className="help-card-label">{t("coachPanel.help.cardLabel")}</p>
      <h3 id={headingId} className="help-card-title" tabIndex={-1}>
        {article.title}
      </h3>
      <CoachReplyText text={article.body} />
      {answered ? (
        <p role="status" className="help-card-thanks">
          {t("coachPanel.help.thanks")}
        </p>
      ) : (
        <div className="help-card-feedback" role="group" aria-label={t("coachPanel.help.answered")}>
          <p>{t("coachPanel.help.answered")}</p>
          <button type="button" className="button" onClick={onAnswered}>
            {t("coachPanel.help.yes")}
          </button>
          <button type="button" className="button" onClick={onAskCoach}>
            {t("coachPanel.help.no")}
          </button>
        </div>
      )}
    </article>
  );
}

/** An empty conversation's help: help comes first, the page in view's article (« Sur cette page »), three frequent questions. */
export function HelpIntro({ pathname, locale, onOpen }: { pathname: string; locale: HelpLocale; onOpen: (article: HelpArticle) => void }) {
  const { t } = useTranslation();
  const here = onThisPage(pathname, locale);
  return (
    <div className="help-intro" data-help>
      <p>{t("coachPanel.help.greeting")}</p>
      {here ? (
        <section className="help-intro-section">
          <h3>{t("coachPanel.help.onThisPage")}</h3>
          <p>
            <strong>{here.article.title}</strong>
          </p>
          <CoachReplyText text={here.excerpt} />
          <button type="button" className="link-action" aria-label={t("coachPanel.help.readMoreAbout", { title: here.article.title })} onClick={() => onOpen(here.article)}>
            {t("coachPanel.help.readMore")}
          </button>
        </section>
      ) : null}
      <section className="help-intro-section">
        <h3>{t("coachPanel.help.oftenAsked")}</h3>
        {/* Buttons, not a list: inside the conversation's first message, a list would read as more messages. */}
        <div className="help-chips">
          {oftenAsked(locale).map((article) => (
            <button key={article.id} type="button" className="button help-chip" onClick={() => onOpen(article)}>
              {article.title}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * With the AI Coach unavailable: « Voici ce que l'aide propose » for the question sent, and, with `onAskTeam`, « Poser la
 * question à l'équipe » directly (#345, ADR-0035).
 */
export function HelpForUnanswered({ question, locale, onOpen, onAskTeam }: { question: string; locale: HelpLocale; onOpen: (article: HelpArticle) => void; onAskTeam?: () => void }) {
  const { t } = useTranslation();
  const found = helpForUnanswered(question, locale);
  return (
    <div className="help-unanswered" data-help>
      {found.length > 0 ? (
        <>
          <p>{t("coachPanel.help.unavailableHelp")}</p>
          <ul className="help-chips">
            {found.map((article) => (
              <li key={article.id}>
                <button type="button" className="button help-chip" onClick={() => onOpen(article)}>
                  {article.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t("coachPanel.help.noHelp")}</p>
      )}
      {onAskTeam ? (
        <p>
          {t("coachPanel.team.unavailable")}{" "}
          <button type="button" className="link-action" onClick={onAskTeam}>
            {t("coachPanel.team.ask")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Under an AI Coach reply (#345, ADR-0035): « Cela répond à votre question ? Oui / Non ». « Non » offers « Poser la
 * question à l'équipe », which takes the focus; « Oui » thanks. A reply the AI Coach marked as one it could not answer
 * (`couldNotAnswer`) offers the team at once, without asking. `satisfied`: the Candidate's answer, if any.
 */
export function ReplyFeedback({
  couldNotAnswer,
  satisfied,
  onAnswer,
  onAskTeam,
}: {
  couldNotAnswer: boolean;
  satisfied: boolean | undefined;
  onAnswer: (satisfied: boolean) => void;
  onAskTeam: () => void;
}) {
  const { t } = useTranslation();
  const askButton = useRef<HTMLButtonElement>(null);
  // Only a « Non » just given moves the focus, never a reply shown again.
  const saidNo = useRef(false);
  useEffect(() => {
    if (satisfied === false && saidNo.current) askButton.current?.focus();
    saidNo.current = false;
  }, [satisfied]);

  if (satisfied === true)
    return (
      <p role="status" className="reply-feedback">
        {t("coachPanel.team.thanks")}
      </p>
    );
  if (couldNotAnswer || satisfied === false)
    return (
      <p className="reply-feedback" data-help>
        {t(couldNotAnswer ? "coachPanel.team.couldNotAnswer" : "coachPanel.team.notSatisfied")}{" "}
        <button ref={askButton} type="button" className="link-action" onClick={onAskTeam}>
          {t("coachPanel.team.ask")}
        </button>
      </p>
    );
  return (
    <div className="reply-feedback" role="group" aria-label={t("coachPanel.team.answered")} data-help>
      <span>{t("coachPanel.team.answered")}</span>
      <button type="button" className="link-action" onClick={() => onAnswer(true)}>
        {t("coachPanel.team.yes")}
      </button>
      <button
        type="button"
        className="link-action"
        onClick={() => {
          saidNo.current = true;
          onAnswer(false);
        }}
      >
        {t("coachPanel.team.no")}
      </button>
    </div>
  );
}
