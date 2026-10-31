"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { HelpArticle } from "@/coach-help";
import { CoachReplyText } from "@/components/CoachReplyText";
import { useConversationFirst } from "@/components/conversation-first";
import { Icons } from "@/components/icons";
import { SignalementPaneForm, signalementTitle } from "@/components/Signalement";
import { WorkPaneContext, askCoachAddress, type WorkPaneItem } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";

const MAIN_ID = "main";
const PANE_CLASS = "work-pane";

/** What the pane shows, and how many times it was opened: each opening mounts its item afresh and takes the focus. */
type Shown = { item: WorkPaneItem; opening: number };
const ShownItem = createContext<{ shown: Shown | null; version: string }>({ shown: null, version: "" });

/**
 * The Work Pane's state for the Candidate's pages under « Conversation au centre » (#602, ADR-0070): what is open, and
 * what had the focus before, which gets it back when the pane closes (or the page itself, when that is gone).
 * `version`: the Jobbbox version a Signalement's detail shows.
 */
export function WorkPaneProvider({ version, children }: { version: string; children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((item: WorkPaneItem) => {
    const active = document.activeElement;
    // Another item opened from inside the pane: the focus still goes back to what opened the pane.
    if (active instanceof HTMLElement && !active.closest(`.${PANE_CLASS}`)) opener.current = active;
    setShown((was) => ({ item, opening: (was?.opening ?? 0) + 1 }));
  }, []);
  const close = useCallback(() => {
    setShown(null);
    const back = opener.current?.isConnected ? opener.current : document.getElementById(MAIN_ID);
    opener.current = null;
    back?.focus();
  }, []);
  const control = useMemo(() => ({ item: shown?.item ?? null, open, close }), [shown, open, close]);
  const showing = useMemo(() => ({ shown, version }), [shown, version]);
  return (
    <WorkPaneContext.Provider value={control}>
      <ShownItem.Provider value={showing}>{children}</ShownItem.Provider>
    </WorkPaneContext.Provider>
  );
}

/**
 * The Work Pane (#602, ADR-0070): the column beside the page's conversation where one item opens to be acted on, never
 * over it; on phones it takes the whole screen (app.css). Its header holds the item's title, which takes the focus, its
 * actions and its ✕ « Fermer »; Escape closes it too. Nothing while it is closed, or outside a WorkPaneProvider.
 */
export function WorkPane() {
  const { t } = useTranslation();
  const { shown, version } = useContext(ShownItem);
  const control = useContext(WorkPaneContext);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const opening = shown?.opening;

  useEffect(() => {
    if (opening) title.current?.focus();
  }, [opening]);

  if (!shown || !control) return null;
  const { close } = control;
  const view = itemView(shown.item, { version, close });

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    close();
  }

  return (
    <aside className={PANE_CLASS} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="work-pane-head">
        <h2 id={titleId} ref={title} tabIndex={-1}>
          {view.title(t)}
        </h2>
        {view.actions}
        <button className={buttonClass({ variant: "quiet" })} type="button" onClick={close}>
          <Icons.close />
          {t("conversationFirst.close")}
        </button>
      </div>
      <div key={shown.opening} className="work-pane-body">
        {view.body}
      </div>
    </aside>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];
type ItemView = { title: (t: Translate) => string; actions?: ReactNode; body: ReactNode };

/** How each kind of item shows in the pane: its title, its header's actions and its body. */
function itemView(item: WorkPaneItem, { version, close }: { version: string; close: () => void }): ItemView {
  switch (item.kind) {
    case "help":
      return { title: () => item.article.title, actions: <AskCoach article={item.article} />, body: <HelpArticleBody article={item.article} /> };
    case "signalement":
      return { title: (t) => t(signalementTitle(item.start)), body: <SignalementPaneForm version={version} start={item.start} onClose={close} /> };
    default:
      throw new Error(`no view for ${item.kind}`);
  }
}

/** An Article card's text (ADR-0035): written by the Jobbbox team, never sent to the AI Coach (only its title, when asked next). */
function HelpArticleBody({ article }: { article: HelpArticle }) {
  const { t } = useTranslation();
  return (
    <article className="work-pane-article">
      <p className="help-card-label">{t("coachPanel.help.cardLabel")}</p>
      <CoachReplyText text={article.body} />
    </article>
  );
}

/**
 * « Demander au coach »: on a page that is a conversation, its box starts a question about the article, the article
 * staying open; elsewhere (Mon compte), a new Free conversation with the article as its context.
 */
function AskCoach({ article }: { article: HelpArticle }) {
  const { t } = useTranslation();
  const page = useConversationFirst()?.page;
  const label = (
    <>
      <Icons.coach />
      {t("conversationFirst.askCoach")}
    </>
  );
  if (page)
    return (
      <button className={buttonClass({ size: "sm" })} type="button" onClick={() => page.askAbout({ id: article.id, title: article.title })}>
        {label}
      </button>
    );
  return (
    <Link className={buttonClass({ size: "sm" })} href={askCoachAddress(article.id)}>
      {label}
    </Link>
  );
}
