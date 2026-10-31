"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { HelpArticle } from "@/coach-help";
import { CoachMemoryView } from "@/components/CoachMemory";
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

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    close();
  }

  return (
    <aside className={PANE_CLASS} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <div className="work-pane-head">
        <h2 id={titleId} ref={title} tabIndex={-1}>
          {shown.item.kind === "help" ? shown.item.article.title : shown.item.kind === "memory" ? t("coachMemory.title") : t(signalementTitle(shown.item.start))}
        </h2>
        {shown.item.kind === "help" ? <AskCoach article={shown.item.article} /> : null}
        <button className={buttonClass({ variant: "quiet" })} type="button" onClick={close}>
          <Icons.close />
          {t("conversationFirst.close")}
        </button>
      </div>
      {/* Scrolls with the keyboard too, when an article is longer than the pane and holds nothing to focus. */}
      <div key={shown.opening} className="work-pane-body" tabIndex={0}>
        <ItemBody item={shown.item} version={version} close={close} heading={title} />
      </div>
    </aside>
  );
}

/** What each kind of item shows in the pane, under the title its header gives it (`heading`). */
function ItemBody({ item, version, close, heading }: { item: WorkPaneItem; version: string; close: () => void; heading: RefObject<HTMLHeadingElement | null> }) {
  switch (item.kind) {
    case "help":
      return <HelpArticleBody article={item.article} />;
    case "signalement":
      return <SignalementPaneForm version={version} start={item.start} onClose={close} />;
    case "memory":
      return <CoachMemoryView heading={heading} />;
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
