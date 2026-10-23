"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ParseKeys } from "i18next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { CoachFocus } from "@/coach";
import { coachReplyBlocks, type Inline } from "@/coach/reply-text";
import type { CoachMessage, JobOfferCard as JobOfferCardData } from "@/coach/conversation";
import { CoachConversationList, type ConversationSummary } from "@/components/CoachConversationList";
import { CoachMemoryProposals, CoachMemoryView } from "@/components/CoachMemory";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icons } from "@/components/icons";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { ProvenanceLine } from "@/components/ProvenanceLine";
import { readNdjson } from "@/ndjson";
import { routes } from "@/routes";
import { formatDuration, formatTokens, isFailureReason, type Activity, type FailureReason, type Provenance, type ProvenanceStep, type StepLabel } from "@jobhub/shared";

/**
 * What a page shows, as the Coach Panel tells the Candidate and the AI Coach.
 * `profileId`: the Profile a Job Search, Job Digest or Application page shows, so a
 * new Coach Conversation is attached to it and the AI Coach can search for it.
 */
export type InView = CoachFocus & { name: string; profileId?: string };

const SetInView = createContext<(inView: InView | null) => void>(() => {});

/** What a Coach Panel button needs: whether the panel is open, and a way to open or close it. */
type Control = {
  open: boolean;
  panelId: string;
  toggle: () => void;
  /** Each button registers itself, so closing the panel gives focus back to the one on screen. */
  register: (button: HTMLButtonElement | null) => (() => void) | undefined;
  /** The button's words. */
  label: ParseKeys;
  /** The AI Coach replies given here about the object of the page in view (#332). */
  repliesInView: readonly ReplyInView[];
};

const CoachPanelControl = createContext<Control | null>(null);

/**
 * An AI Coach reply given in this browser while a page's object (an Application, a Job Offer or a Profile) was in view:
 * AI Activity counts it with that page at once (#332), before the page is next loaded with it.
 */
export type ReplyInView = { provenance: Provenance | null; at: string };
const NO_REPLIES: readonly ReplyInView[] = [];
/** The page objects a reply is kept with as its focus (coach-conversations), so counted with their page. */
const FOCUS_KINDS: ReadonlySet<string> = new Set(["application", "job_offer", "profile"]);
const focusKey = (inView: InView) => `${inView.kind}:${inView.id}`;

/** The AI Coach replies given in this browser about the object of the page in view; none outside a Coach Panel. */
export function useCoachRepliesInView(): readonly ReplyInView[] {
  return useContext(CoachPanelControl)?.repliesInView ?? NO_REPLIES;
}

/** The menu opens under the conversation's title, from its start. */
const MENU_ALIGN = "start";
const MEMORY_VIEW = "memory";

/**
 * The button that opens and closes the Coach Panel. The sidebar layout puts
 * one in its top bar; every other page gets the floating one the Coach Panel
 * renders itself, hidden where a top bar has one (see app.css). Renders
 * nothing outside a Coach Panel (signed-out pages).
 */
export function CoachPanelToggle({ floating = false }: { floating?: boolean }) {
  const { t } = useTranslation();
  const control = useContext(CoachPanelControl);
  if (!control) return null;
  const { open, panelId, toggle, register, label } = control;
  // While the panel is open its Fermer button closes it: the toggle steps aside (ADR-0024).
  if (open) return null;
  return (
    <button
      ref={register}
      className={floating ? "button button-primary coach-panel-toggle coach-panel-toggle-floating" : "button coach-panel-toggle"}
      type="button"
      aria-expanded={false}
      aria-controls={panelId}
      onClick={toggle}
    >
      <Icons.coach />
      {t(label)}
    </button>
  );
}

/**
 * Declares the Profile, Application, Job Offer, Job Search or Job Digest a page
 * shows, or the Agenda, so the Coach Panel (and the AI Coach behind it) know what the Candidate
 * has in view. Renders nothing; does nothing outside a Coach Panel (signed-out pages).
 */
export function CoachInView({ kind, id, name, profileId }: InView) {
  const setInView = useContext(SetInView);
  useEffect(() => {
    setInView({ kind, id, name, ...(profileId ? { profileId } : {}) } as InView);
    return () => setInView(null);
  }, [setInView, kind, id, name, profileId]);
  return null;
}

/** The Profile in view, or the one the page in view shows. */
const profileIdOf = (inView: InView | null) => (inView?.kind === "profile" ? inView.id : inView?.profileId);

const IN_VIEW_LABEL = {
  profile: "coachPanel.inViewProfile",
  application: "coachPanel.inViewApplication",
  job_offer: "coachPanel.inViewJobOffer",
  job_search: "coachPanel.inViewJobSearch",
  job_digest: "coachPanel.inViewJobDigest",
  agenda: "coachPanel.inViewAgenda",
} as const satisfies Record<InView["kind"], string>;

type Status = "idle" | "sending" | "unavailable" | "invalid";

/** A reply the Candidate stopped (#328): shown in its place until the conversation reopens, with what it had spent. */
type StoppedReply = { from: "stopped"; tokens: number; ms: number };

/** What the panel lists: the saved messages, and the replies stopped since it opened. */
type PanelMessage = CoachMessage | StoppedReply;

/** A reply on its way, live (#328): the step under way, with its Activity and label, and the tokens spent so far. */
type Live = { step: { activity: Activity; label: StepLabel } | null; tokens: number };

/** What POST /api/coach streams (see its route). */
type LiveEvent =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "step_started"; step: { activity: Activity }; label: StepLabel }
  | { type: "step_ended"; step: ProvenanceStep }
  | ({ type: "reply" } & ReplyBody)
  | { type: "stopped"; conversation: ConversationSummary }
  | { type: "failed"; error: string; reason?: string };

/** A saved reply, as the server gives it back. */
type ReplyBody = {
  conversation: ConversationSummary;
  reply: string;
  blocked?: { message?: boolean; reply?: boolean };
  jobOffer?: JobOfferCardData;
  provenance?: Provenance | null;
  at?: string;
};

/** The tokens a step spent: none for one stopped or failed (providers say nothing then). */
const tokensOf = (step: ProvenanceStep) => (step.kind === "ai" && step.tokens ? step.tokens.input + step.tokens.output : 0);

/**
 * Which panel it is: the Candidate's Coach Panel, with the AI Coach, or the
 * Back Office Assistant (#205), the same panel for Administrators in the Back
 * Office, with its own conversations and no Coach Memory, nothing In view and
 * no Job Search.
 */
export type PanelKind = "coach" | "backOfficeAssistant";

/** What a message's author is called on the server, for each panel. */
type ServerMessage = {
  from: "candidate" | "coach" | "administrator" | "assistant";
  text: string;
  blocked?: true;
  jobOffer?: JobOfferCardData;
  /** On a reply: what served it (#327), null when nothing was kept, and when it was saved. */
  provenance?: Provenance | null;
  at?: string;
};

/** Everything that differs between the two panels. */
interface PanelConfig {
  send: string;
  conversations: string;
  /** This browser remembers which conversation was open, to reopen it after a reload. */
  storageKey: string;
  features: {
    /** The Coach Memory view and its proposals. */
    memory: boolean;
    /** Each step of a reply shown live, and « Arrêter » while it is on its way (#328). */
    live: boolean;
    /** What the page has in view goes with each message, and the Job Search it allows. */
    inView: boolean;
  };
  /**
   * `title`, the panel's visible title, and `badge`, by the message box, say the AI is an AI (AI Act art. 50(1), #324),
   * whatever the width and in every conversation.
   */
  texts: Record<"open" | "title" | "badge" | "welcome" | "thinking" | "unavailable" | "messagesLabel" | "author" | "retention" | "noConversations", ParseKeys> & {
    /** Shown where the Coach Panel says what is in view, for a panel that follows nothing in view. */
    context?: ParseKeys;
    /**
     * The fixed first message of every new conversation, saying the AI is an AI, not a person (#324): never an AI
     * reply. It replaces the welcome; a conversation saved before it existed keeps the welcome.
     */
    aiDisclosure?: ParseKeys;
  };
}

const PANELS: Record<PanelKind, PanelConfig> = {
  coach: {
    send: "/api/coach",
    conversations: "/api/coach/conversations",
    storageKey: "jobhub.coachConversation",
    features: { memory: true, inView: true, live: true },
    texts: {
      open: "coachPanel.open",
      title: "coachPanel.title",
      badge: "coachPanel.badge",
      welcome: "coachPanel.welcome",
      aiDisclosure: "coachPanel.aiDisclosure",
      thinking: "coachPanel.thinking",
      unavailable: "coachPanel.errors.unavailable",
      messagesLabel: "coachPanel.messagesLabel",
      author: "questionnaire.coach",
      retention: "coachPanel.retention",
      noConversations: "coachPanel.noConversations",
    },
  },
  backOfficeAssistant: {
    send: "/api/admin/assistant",
    conversations: "/api/admin/assistant/conversations",
    storageKey: "jobhub.backOfficeAssistantConversation",
    features: { memory: false, inView: false, live: false },
    texts: {
      open: "backOfficeAssistant.open",
      title: "backOfficeAssistant.title",
      badge: "backOfficeAssistant.badge",
      welcome: "backOfficeAssistant.welcome",
      thinking: "backOfficeAssistant.thinking",
      unavailable: "backOfficeAssistant.unavailable",
      messagesLabel: "backOfficeAssistant.messagesLabel",
      author: "backOfficeAssistant.author",
      retention: "backOfficeAssistant.retention",
      noConversations: "backOfficeAssistant.noConversations",
      context: "backOfficeAssistant.readOnly",
    },
  },
};

/** A message as the panel shows it: the person's own, or the AI's reply. */
const asPanelMessage = (message: ServerMessage): CoachMessage => ({
  from: message.from === "candidate" || message.from === "administrator" ? "candidate" : "coach",
  text: message.text,
  ...(message.blocked ? { blocked: true as const } : {}),
  ...(message.jobOffer ? { jobOffer: message.jobOffer } : {}),
  ...(message.at ? { provenance: message.provenance ?? null, at: message.at } : {}),
});

function remember(storageKey: string, conversationId: string | null) {
  try {
    if (conversationId) window.localStorage.setItem(storageKey, conversationId);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Storage blocked: the conversation is still saved, only not reopened by itself.
  }
}

function remembered(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/** An AI Coach reply set as paragraphs, lists and bold or italic text, never raw Markdown (#164). */
function CoachReplyText({ text }: { text: string }) {
  const line = (inlines: Inline[]) =>
    inlines.map((part, i) => {
      let node: ReactNode = part.text;
      if (part.emphasis) node = <em>{node}</em>;
      if (part.strong) node = <strong>{node}</strong>;
      return <span key={i}>{node}</span>;
    });
  const lines = (list: Inline[][]) =>
    list.map((inlines, i) => (
      <span key={i}>
        {i > 0 ? <br /> : null}
        {line(inlines)}
      </span>
    ));
  return (
    <>
      {coachReplyBlocks(text).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>{lines(block.lines)}</p>
        ) : block.ordered ? (
          <ol key={index} start={block.start}>
            {block.items.map((item, i) => (
              <li key={i}>{lines(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={index}>
            {block.items.map((item, i) => (
              <li key={i}>{lines(item)}</li>
            ))}
          </ul>
        ),
      )}
    </>
  );
}

/** « Réponse arrêtée » (#328), in light red, with the tokens and time the stopped reply had spent: no confirmation, no reply saved. */
function StoppedReplyLine({ reply }: { reply: StoppedReply }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language === "en" ? "en" : "fr";
  return (
    <p>
      {t("coachPanel.stopped")}
      <span className="chat-stopped-spent">
        {" · "}
        {formatTokens(reply.tokens, language)}
        <span className="visually-hidden"> {t("provenanceLine.tokens")}</span>
        {" · "}
        {formatDuration(reply.ms, language)}
      </span>
    </p>
  );
}

/**
 * A Job Offer card: the Job Offer an AI Coach reply read from a pasted link, linking to its page, where the
 * Candidate processes it. "À traiter" until they follow it; its state said in words, never by colour alone.
 */
function JobOfferCard({ jobOffer }: { jobOffer: JobOfferCardData }) {
  const { t } = useTranslation();
  return (
    <article className="job-offer-card" aria-label={t("coachPanel.jobOfferLink.card")}>
      <span className="pill" data-tone={jobOffer.followed ? "success" : "accent"}>
        {t(jobOffer.followed ? "coachPanel.jobOfferLink.followed" : "coachPanel.jobOfferLink.toProcess")}
      </span>
      <p className="job-offer-card-title">{jobOffer.title}</p>
      {jobOffer.employer ? <p className="hint">{jobOffer.employer}</p> : null}
      <Link className="button" href={routes.jobOffer(jobOffer.id)}>
        {t("coachPanel.jobOfferLink.open")}
      </Link>
    </article>
  );
}

/** A saved conversation with its messages, or null when it is gone or cannot be read. */
async function fetchConversation(
  endpoint: string,
  conversationId: string,
): Promise<{ conversation: ConversationSummary & { aiDisclosure: boolean; messages: CoachMessage[] } } | { gone: boolean }> {
  const response = await fetch(`${endpoint}/${encodeURIComponent(conversationId)}`).catch(() => null);
  if (!response?.ok) return { gone: response?.status === 404 };
  const { conversation } = (await response.json()) as { conversation: ConversationSummary & { aiDisclosure?: boolean; messages: ServerMessage[] } };
  return { conversation: { ...conversation, aiDisclosure: conversation.aiDisclosure === true, messages: conversation.messages.map(asPanelMessage) } };
}

/**
 * The Coach Panel: the side panel, available from every page of a signed-in
 * Candidate, where they talk with the AI Coach. Each exchange is saved in a
 * Coach Conversation, which carries over from page to page and reopens after a
 * reload; each message goes with what the Candidate has in view. The Candidate
 * starts new conversations and lists, reopens, renames or deletes saved ones.
 * With a Profile in view, the Candidate can also ask the AI Coach to search
 * for Job Offers for it. `kind="backOfficeAssistant"`: the same panel for an
 * Administrator in the Back Office (see PanelKind).
 */
export function CoachPanel({ kind = "coach", children }: { kind?: PanelKind; children: ReactNode }) {
  const { t } = useTranslation();
  const panel = PANELS[kind];
  const texts = panel.texts;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [inView, setInViewState] = useState<InView | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  // Whether the conversation in view opened with the AI disclosure: a new one does, until it is saved.
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [view, setView] = useState<"chat" | "list" | "memory">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // Why the last reply failed, its Failure Reason in words (#328), never the technical message.
  const [failure, setFailure] = useState<FailureReason | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  // Aborts the reply on its way: the Candidate's Stop.
  const stopper = useRef<AbortController | null>(null);
  const [focusInput, setFocusInput] = useState(0);
  const restored = useRef(false);
  const toggles = useRef(new Set<HTMLButtonElement>());
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const setInView = useCallback((next: InView | null) => setInViewState(next), []);
  // Agrandir: the panel widens into a modal drawer over the page (ADR-0024); never remembered.
  const [wide, setWide] = useState(false);
  const focusMoved = useRef(false);
  // The replies given about a page's object, by its focus key, for AI Activity (#332).
  const [repliesGiven, setRepliesGiven] = useState<readonly (ReplyInView & { focus: string })[]>([]);
  const inViewKey = inView ? focusKey(inView) : null;
  const repliesInView = useMemo(() => repliesGiven.filter((reply) => reply.focus === inViewKey), [repliesGiven, inViewKey]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, focusInput]);

  function openPanel() {
    setOpen(true);
    // The first time the panel opens, reopen the conversation this browser had open.
    if (restored.current) return;
    restored.current = true;
    const conversationId = remembered(panel.storageKey);
    if (!conversationId) return;
    setRestoring(true);
    void fetchConversation(panel.conversations, conversationId).then((found) => {
      if ("conversation" in found) {
        const { messages: saved, aiDisclosure: disclosed, ...summary } = found.conversation;
        setConversation(summary);
        setAiDisclosure(disclosed);
        setMessages(saved);
      } else if (found.gone) remember(panel.storageKey, null);
      setRestoring(false);
    });
  }

  function close() {
    setOpen(false);
    setWide(false);
    // The button on screen: the top bar's, or the floating one where there is no top bar,
    // once it is back (the toggle steps aside while the panel is open).
    requestAnimationFrame(() => [...toggles.current].find((button) => button.getClientRects().length > 0)?.focus());
  }

  const register = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return undefined;
    toggles.current.add(button);
    return () => {
      toggles.current.delete(button);
    };
  }, []);

  // Escape brings a widened panel back beside the page first, then closes it.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (wide) setWide(false);
    else close();
  }

  /** A menu item whose view takes the focus: the menu must not hand it back to its button. */
  function moveFocus(action: () => void) {
    focusMoved.current = true;
    action();
  }

  function showMemory() {
    setView(MEMORY_VIEW);
  }

  function showChat() {
    setView("chat");
    setFocusInput((n) => n + 1);
  }

  function startNewConversation() {
    setConversation(null);
    setAiDisclosure(true);
    setMessages([]);
    setStatus("idle");
    remember(panel.storageKey, null);
    showChat();
  }

  async function showList() {
    setView("list");
    setConversations(null);
    setListFailed(false);
    const response = await fetch(panel.conversations).catch(() => null);
    if (response?.ok) setConversations((await response.json()).conversations);
    else setListFailed(true);
  }

  // The latest message (or the "thinking" notice) comes into view when it arrives (#164): the
  // body scrolls to where the messages end, not to its own end, which holds the Coach Memory
  // proposals (#125) and would push the latest reply out of sight in a short panel.
  useEffect(() => {
    const element = body.current;
    const end = messagesEnd.current;
    if (element && end) element.scrollTop += end.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
  }, [messages, status, view, open]);

  async function openConversation(conversationId: string): Promise<boolean> {
    const found = await fetchConversation(panel.conversations, conversationId);
    if (!("conversation" in found)) {
      if (found.gone) setConversations((list) => list?.filter((item) => item.id !== conversationId) ?? null);
      return false;
    }
    const { messages: saved, aiDisclosure: disclosed, ...summary } = found.conversation;
    setConversation(summary);
    setAiDisclosure(disclosed);
    setMessages(saved);
    setStatus("idle");
    remember(panel.storageKey, summary.id);
    showChat();
    return true;
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || status === "sending" || restoring) return;
    // What the reply is about, as the server keeps it: counted with that page in AI Activity.
    const about = kind === "coach" && inView && FOCUS_KINDS.has(inView.kind) ? focusKey(inView) : null;
    const shown: PanelMessage[] = [...messages, { from: "candidate", text }];
    setMessages(shown);
    setDraft("");
    setStatus("sending");
    setFailure(null);
    const stop = new AbortController();
    stopper.current = stop;
    const startedAt = Date.now();
    let spent = 0;
    // The conversation the message goes to, once the server says (a new one is named already): where a Stop keeps it.
    let asked: ConversationSummary | null = conversation;
    if (panel.features.live) setLive({ step: null, tokens: 0 });

    const giveBack = (error: Status, reason?: unknown) => {
      // Give the Candidate their message back to retry or shorten it.
      setMessages(messages);
      setDraft(text);
      setStatus(error);
      setFailure(isFailureReason(reason) ? reason : null);
    };
    const answered = (body: ReplyBody) => {
      setConversation(body.conversation);
      remember(panel.storageKey, body.conversation.id);
      // A Blocked message (#228): the Guardrail is never named, only that the message or the reply was blocked.
      const blocked = body.blocked;
      setMessages([
        ...messages,
        { from: "candidate", text, ...(blocked?.message ? { blocked: true as const } : {}) },
        {
          from: "coach",
          text: body.reply,
          ...(blocked?.reply ? { blocked: true as const } : {}),
          ...(body.jobOffer ? { jobOffer: body.jobOffer } : {}),
          ...(typeof body.at === "string" ? { provenance: body.provenance ?? null, at: body.at } : {}),
        },
      ]);
      if (about && typeof body.at === "string") setRepliesGiven((given) => [...given, { focus: about, provenance: body.provenance ?? null, at: body.at }]);
      setStatus("idle");
    };
    const gone = () => {
      // Deleted meanwhile (another tab, or kept past its 12 months): the message starts a new one.
      setConversation(null);
      setAiDisclosure(true);
      remember(panel.storageKey, null);
      setMessages([]);
      setDraft(text);
      setStatus("unavailable");
    };
    // Stopped (#316 answer 11): the question stays, saved in its conversation; « Réponse arrêtée » stands in for the reply.
    const stopped = (where: ConversationSummary | null) => {
      if (where) {
        setConversation(where);
        remember(panel.storageKey, where.id);
      }
      setMessages([...shown, { from: "stopped", tokens: spent, ms: Date.now() - startedAt }]);
      setStatus("idle");
    };

    try {
      const response = await fetch(panel.send, {
        method: "POST",
        headers: { "content-type": "application/json", ...(panel.features.live ? { accept: "application/x-ndjson" } : {}) },
        // The server holds the conversation: only the new message goes.
        body: JSON.stringify({
          ...(conversation ? { conversationId: conversation.id } : {}),
          message: text,
          ...(inView && panel.features.inView ? { focus: { kind: inView.kind, id: inView.id, ...(inView.profileId ? { profileId: inView.profileId } : {}) } } : {}),
        }),
        signal: stop.signal,
      });
      if (response.ok && response.body && response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
        let ended = false;
        await readNdjson(response.body, (received) => {
          const event = received as LiveEvent;
          if (event.type === "conversation") asked = event.conversation;
          else if (event.type === "step_started") setLive({ step: { activity: event.step.activity, label: event.label }, tokens: spent });
          else if (event.type === "step_ended") {
            spent += tokensOf(event.step);
            setLive((was) => (was ? { ...was, tokens: spent } : was));
          } else {
            ended = true;
            if (event.type === "reply") answered(event);
            else if (event.type === "stopped") stopped(event.conversation);
            else if (event.error === "not_found") gone();
            else giveBack(event.error === "invalid" ? "invalid" : "unavailable", event.reason);
          }
        });
        if (!ended) throw new Error("the reply was cut short");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body.reply === "string") answered(body as ReplyBody);
      else if (response.status === 404) gone();
      else giveBack(body.error === "invalid" ? "invalid" : "unavailable", body.reason);
    } catch {
      if (stop.signal.aborted) stopped(asked);
      else giveBack("unavailable");
    } finally {
      stopper.current = null;
      setLive(null);
    }
  }

  const inViewLabel = inView
    ? t("coachPanel.inView", {
        label: t(IN_VIEW_LABEL[inView.kind], { name: inView.name }),
      })
    : t("coachPanel.nothingInView");

  const contextText = panel.features.inView || !texts.context ? inViewLabel : t(texts.context);
  const conversationTitle = conversation ? conversation.title : t("coachPanel.newConversation");
  // The conversation's first message: the AI disclosure, or the welcome of a panel without one or of a conversation saved before it.
  const opening = texts.aiDisclosure && aiDisclosure ? texts.aiDisclosure : texts.welcome;

  const control: Control = { open, panelId: `${id}-panel`, toggle: () => (open ? close() : openPanel()), register, label: texts.open, repliesInView };

  return (
    <SetInView.Provider value={setInView}>
      <CoachPanelControl.Provider value={control}>
        {/* A widened panel is modal: the page beneath is out of reach until it narrows or closes. */}
        <div className={open ? "with-coach-panel" : undefined} inert={open && wide} aria-hidden={(open && wide) || undefined}>
          {children}
        </div>
        {open && wide ? <div className="coach-panel-scrim" aria-hidden="true" onClick={() => setWide(false)} /> : null}
        {open ? (
          <aside
            id={`${id}-panel`}
            className={wide ? "coach-panel coach-panel-wide" : "coach-panel"}
            aria-labelledby={`${id}-title`}
            aria-modal={wide || undefined}
            role={wide ? "dialog" : undefined}
            onKeyDown={onKeyDown}
          >
            <div className="coach-panel-header">
              <h2 id={`${id}-title`} className="coach-panel-title">
                {t(texts.title)}
              </h2>
              <DropdownMenu.Root modal={false}>
                <DropdownMenu.Trigger className="button button-quiet coach-panel-menu-button">
                  <span className="coach-panel-menu-title">{view === "list" ? t("coachPanel.conversations") : view === "memory" ? t("coachMemory.open") : conversationTitle}</span>
                  <Icons.chevron />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="menu coach-panel-menu"
                    align={MENU_ALIGN}
                    sideOffset={4}
                    // An item that moves focus on (the list's heading, the message box) keeps it there.
                    onCloseAutoFocus={(event) => {
                      if (focusMoved.current) event.preventDefault();
                      focusMoved.current = false;
                    }}
                  >
                    <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(startNewConversation)}>
                      <Icons.add />
                      {t("coachPanel.newConversation")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(() => void showList())}>
                      <Icons.conversations />
                      {t("coachPanel.conversations")}
                    </DropdownMenu.Item>
                    {panel.features.memory ? (
                      <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(showMemory)}>
                        <Icons.coach />
                        {t("coachMemory.open")}
                      </DropdownMenu.Item>
                    ) : null}
                    {view !== "chat" ? (
                      <>
                        <DropdownMenu.Separator className="menu-separator" />
                        <DropdownMenu.Item className="menu-item" onSelect={() => moveFocus(showChat)}>
                          {t("coachPanel.backToConversation")}
                        </DropdownMenu.Item>
                      </>
                    ) : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <div className="coach-panel-actions">
                <button className="button button-quiet coach-panel-widen" type="button" onClick={() => setWide((was) => !was)}>
                  {t(wide ? "coachPanel.narrow" : "coachPanel.widen")}
                </button>
                <button className="button button-quiet" type="button" onClick={close}>
                  <Icons.close />
                  {t("coachPanel.close")}
                </button>
              </div>
            </div>
            {view === "memory" ? (
              <div className="coach-panel-body">
                <CoachMemoryView />
              </div>
            ) : view === "list" ? (
              <div className="coach-panel-body">
                <CoachConversationList
                  endpoint={panel.conversations}
                  texts={texts}
                  conversations={conversations}
                  loadFailed={listFailed}
                  onOpen={openConversation}
                  onRenamed={(renamed) => {
                    setConversations((list) => list?.map((item) => (item.id === renamed.id ? renamed : item)) ?? null);
                    if (conversation?.id === renamed.id) setConversation(renamed);
                  }}
                  onDeleted={(deletedId) => {
                    setConversations((list) => list?.filter((item) => item.id !== deletedId) ?? null);
                    if (conversation?.id === deletedId) {
                      setConversation(null);
                      setAiDisclosure(true);
                      setMessages([]);
                      remember(panel.storageKey, null);
                    }
                  }}
                />
              </div>
            ) : (
              <>
                <div className="coach-panel-body" ref={body}>
                  <h3 className="visually-hidden">{conversationTitle}</h3>
                  {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
                  <ol className="chat coach-panel-messages" aria-label={t(texts.messagesLabel)} aria-live="polite">
                    {/* Until a reopened conversation is back, which opening it had is not known yet. */}
                    {restoring ? null : (
                      <li className="chat-message chat-coach">
                        {/* No visible author (#317, #327): screen readers still hear who speaks. */}
                        <span className="visually-hidden">{t(texts.author)}</span>
                        <p>{t(opening)}</p>
                      </li>
                    )}
                    {messages.map((message, index) =>
                      message.from === "stopped" ? (
                        <li key={index} className="chat-message chat-coach chat-stopped">
                          <span className="visually-hidden">{t(texts.author)}</span>
                          <StoppedReplyLine reply={message} />
                        </li>
                      ) : (
                      <li key={index} className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}${message.blocked ? " chat-blocked" : ""}`}>
                        <span className="visually-hidden">{message.from === "coach" ? t(texts.author) : t("questionnaire.you")}</span>
                        {message.blocked ? <span className="chat-blocked-label">{t("coachPanel.blocked")}</span> : null}
                        {message.from === "coach" ? <CoachReplyText text={message.text} /> : <p>{message.text}</p>}
                        {message.jobOffer ? <JobOfferCard jobOffer={message.jobOffer} /> : null}
                        {message.from === "coach" && message.at ? <ProvenanceLine provenance={message.provenance ?? null} at={message.at} /> : null}
                      </li>
                      ),
                    )}
                  </ol>
                  {status === "sending" && live ? (
                    <>
                      {/* Only the start is announced (the reply, or its Stop, is announced by the list): each step is shown, not read out. */}
                      <p className="visually-hidden" role="status">
                        {t(texts.thinking)}
                      </p>
                      {live.step ? (
                        <p className="coach-panel-step">
                          <ActivityGlyph activity={live.step.activity} />
                          {t(`aiActivity.steps.${live.step.label}`)}
                        </p>
                      ) : null}
                    </>
                  ) : status === "sending" ? (
                    <p className="notice" role="status">
                      {t(texts.thinking)}
                    </p>
                  ) : null}
                  {status === "unavailable" || status === "invalid" ? (
                    <p className={failure ? "notice notice-failed" : "notice"} role="alert">
                      {status === "invalid"
                        ? t("coachPanel.errors.invalid")
                        : failure
                          ? t("coachPanel.failed", { reason: t(`failureReasons.${failure}`) })
                          : t(texts.unavailable)}
                    </p>
                  ) : null}
                  <div ref={messagesEnd} aria-hidden="true" />
                  {conversation && panel.features.memory ? <CoachMemoryProposals key={conversation.id} conversationId={conversation.id} /> : null}
                </div>
                <form className="coach-panel-form" onSubmit={send}>
                  <label className="visually-hidden" htmlFor={`${id}-message`}>
                    {t("coachPanel.messageLabel")}
                  </label>
                  {/* The Send button sits inside the message box; a click anywhere in the box writes in it. */}
                  <div className="coach-panel-composer" onClick={(event) => event.target === event.currentTarget && input.current?.focus()}>
                    <textarea
                      id={`${id}-message`}
                      ref={input}
                      rows={2}
                      placeholder={t("coachPanel.messageLabel")}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="coach-panel-composer-actions">
                      {/* Says, by the message box, that the one answering is an AI (#324). */}
                      <span className="pill coach-panel-badge" data-tone="accent">
                        {t(texts.badge)}
                      </span>
                      {/* While a reply is on its way « Envoyer » becomes « Arrêter » (#328), the same button, so focus stays on it. */}
                      {status === "sending" && panel.features.live ? (
                        <button key="send" className="button" type="button" onClick={() => stopper.current?.abort()}>
                          {t("coachPanel.stop")}
                        </button>
                      ) : (
                        <button key="send" className="button button-primary" type="submit" disabled={status === "sending" || restoring}>
                          {t("coachPanel.send")}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* What goes with the message: one line, opened for the whole text (and the Job Search). */}
                  <details className="coach-panel-context">
                    <summary>
                      <Icons.coach />
                      <span className="coach-panel-context-line">{contextText}</span>
                    </summary>
                    <div className="coach-panel-context-more">
                      <p className="coach-panel-in-view">{contextText}</p>
                      {!panel.features.inView ? null : profileIdOf(inView) ? (
                        <StartJobSearchButton key={profileIdOf(inView)} profileId={profileIdOf(inView)!} label={t("coachPanel.searchJobs")} className="button" />
                      ) : (
                        <p className="hint">{t("coachPanel.searchHint")}</p>
                      )}
                    </div>
                  </details>
                </form>
              </>
            )}
          </aside>
        ) : null}
        <CoachPanelToggle floating />
      </CoachPanelControl.Provider>
    </SetInView.Provider>
  );
}

/**
 * The Candidate's Coach Panel around every page but the Back Office's, whose
 * pages carry the Back Office Assistant instead (BackOfficeLayout): only one
 * panel is ever mounted.
 */
export function CandidateCoachPanel({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inBackOffice = pathname === routes.admin || pathname.startsWith(`${routes.admin}/`);
  return inBackOffice ? children : <CoachPanel>{children}</CoachPanel>;
}
