"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { HelpArticle } from "@/coach-help";
import { CoachMemoryView } from "@/components/CoachMemory";
import { OpenInHelpCentre } from "@/components/CoachHelp";
import { CoachReplyText } from "@/components/CoachReplyText";
import { useConversationFirst } from "@/components/conversation-first";
import { Icons } from "@/components/icons";
import { SignalementPaneForm, signalementTitle } from "@/components/Signalement";
import { WorkPaneContext, askCoachAddress, type AddressedKind, type WorkPaneItem } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";

const MAIN_ID = "main";
const PANE_CLASS = "work-pane";

/** What the pane shows, and how many times it was opened: each opening mounts its item afresh and takes the focus. */
type Shown = { item: WorkPaneItem; opening: number };
const ShownItem = createContext<{ shown: Shown | null; version: string; setSlot: (slot: HTMLElement | null) => void }>({ shown: null, version: "", setSlot: () => {} });
/** Where a Section or a Result shown in the pane is drawn (InWorkPane): the pane's body, while it shows one. */
const Slot = createContext<HTMLElement | null>(null);

/**
 * The Work Pane's state for the Candidate's pages under « Conversation au centre » (#602, ADR-0070): what is open, and
 * what had the focus before, which gets it back when the pane closes (or the page itself, when that is gone).
 * `version`: the Jobbbox version a Signalement's detail shows.
 */
export function WorkPaneProvider({ version, children }: { version: string; children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Counts every opening, closings in between included: an item opened as another closes still takes the focus.
  const openings = useRef(0);
  const open = useCallback((item: WorkPaneItem) => {
    const active = document.activeElement;
    // Another item opened from inside the pane: the focus still goes back to what opened the pane.
    if (active instanceof HTMLElement && !active.closest(`.${PANE_CLASS}`)) opener.current = active;
    openings.current += 1;
    setShown({ item, opening: openings.current });
  }, []);
  // The focus goes back once the pane is gone: what opened it may only show again then (the Fiche, which gives the Work
  // Pane its place on a narrower screen, Fiche.tsx). Only when the pane had it: closed from elsewhere (« Fiche » in the
  // Top Bar, bringing the Fiche back), the focus stays where it is.
  const focusBack = useRef(false);
  const close = useCallback(() => {
    const active = document.activeElement;
    focusBack.current = !(active instanceof HTMLElement) || active === document.body || active.closest(`.${PANE_CLASS}`) !== null;
    setShown(null);
  }, []);
  useLayoutEffect(() => {
    if (shown || !focusBack.current) return;
    focusBack.current = false;
    const back = opener.current?.isConnected ? opener.current : document.getElementById(MAIN_ID);
    opener.current = null;
    back?.focus();
  }, [shown]);
  const control = useMemo(() => ({ item: shown?.item ?? null, open, close }), [shown, open, close]);
  const showing = useMemo(() => ({ shown, version, setSlot }), [shown, version]);
  return (
    <WorkPaneContext.Provider value={control}>
      <ShownItem.Provider value={showing}>
        <Slot.Provider value={slot}>{children}</Slot.Provider>
      </ShownItem.Provider>
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
  const { shown, version, setSlot } = useContext(ShownItem);
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
          <ItemTitle item={shown.item} />
        </h2>
        {shown.item.kind === "help" ? <AskCoach article={shown.item.article} /> : null}
        <button className={buttonClass({ variant: "quiet" })} type="button" onClick={close}>
          <Icons.close />
          {t("conversationFirst.close")}
        </button>
      </div>
      {/* Scrolls with the keyboard too, when an article is longer than the pane and holds nothing to focus. */}
      <div key={shown.opening} className="work-pane-body" tabIndex={0}>
        <ItemBody item={shown.item} version={version} close={close} heading={title} setSlot={setSlot} />
      </div>
    </aside>
  );
}

/** An item's title, in the pane's header. */
function ItemTitle({ item }: { item: WorkPaneItem }) {
  const { t } = useTranslation();
  switch (item.kind) {
    case "help":
      return item.article.title;
    case "memory":
      return t("coachMemory.title");
    case "signalement":
      return t(signalementTitle(item.start));
    case "section":
    case "result":
    case "form":
      return item.title;
  }
}

/**
 * What each kind of item shows in the pane, under the title its header gives it (`heading`). A Section or a Result is
 * drawn into it from its page (InWorkPane), through `setSlot`.
 */
function ItemBody({
  item,
  version,
  close,
  heading,
  setSlot,
}: {
  item: WorkPaneItem;
  version: string;
  close: () => void;
  heading: RefObject<HTMLHeadingElement | null>;
  setSlot: (slot: HTMLElement | null) => void;
}) {
  switch (item.kind) {
    case "section":
    case "result":
    case "form":
      return <div ref={setSlot} className="work-pane-slot" />;
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
      <OpenInHelpCentre article={article} />
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

/**
 * An object's Section or Result, at its own address (`href`), shown in the Work Pane under `title` rather than in the page
 * (#603, ADR-0070): the page renders it here, its actions working as they do on the page, and the pane draws it. Opening
 * it takes the focus to its title; closing it (✕, Escape) or opening another item in its place goes back to `back`, the
 * object's own address, so the address always says what is shown. Its address left otherwise (the browser's Back, a link
 * elsewhere), the pane closes with it; at another address (a Result of the Section shown, say), it is another item.
 * Nothing outside a WorkPaneProvider.
 */
export function InWorkPane(props: { kind: AddressedKind; title: string; href: string; back: string; children: ReactNode }) {
  return <Addressed key={`${props.kind} ${props.href}`} {...props} />;
}

/** InWorkPane, for one address: another address mounts another one, so nothing it remembers carries over to it. */
function Addressed({ kind, title, href, back, children }: { kind: AddressedKind; title: string; href: string; back: string; children: ReactNode }) {
  const control = useContext(WorkPaneContext);
  const slot = useContext(Slot);
  const router = useRouter();
  const open = control?.open;
  const close = control?.close;
  const item = control?.item;
  const mine = item?.kind === kind && item.href === href;
  const shownOnce = useRef(false);
  const shownNow = useRef(false);

  useEffect(() => {
    open?.({ kind, title, href });
  }, [open, kind, title, href]);

  // Closed, or replaced by another item: the address goes back to the object's.
  useEffect(() => {
    shownNow.current = mine;
    if (mine) shownOnce.current = true;
    else if (shownOnce.current) {
      shownOnce.current = false;
      router.push(back, { scroll: false });
    }
  }, [mine, back, router]);

  // Its address left while the pane still shows it: the pane closes, not to stay open and empty.
  useEffect(
    () => () => {
      if (shownNow.current) close?.();
    },
    [close],
  );

  if (!control || !mine || !slot) return null;
  // Drawn in the pane, it is still part of the page: its keys reach the page, not the pane, so it closes on Escape itself.
  return createPortal(
    <div
      className="work-pane-addressed"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        control.close();
      }}
    >
      {children}
    </div>,
    slot,
  );
}
