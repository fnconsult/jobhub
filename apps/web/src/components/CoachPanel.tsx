"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ParseKeys } from "i18next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { ExplainedItem } from "@/back-office-assistant/conversation";
import type { CoachFocus } from "@/coach";
import type { SubjectMenu } from "@/coach-conversations";
import type { CoachMessage, JobOfferCard as JobOfferCardData } from "@/coach/conversation";
import { CoachConversationList, type ConversationSummary } from "@/components/CoachConversationList";
import { useConversationFirst } from "@/components/conversation-first";
import { CoachMemoryProposals, CoachMemoryView } from "@/components/CoachMemory";
import { CoachReplyText } from "@/components/CoachReplyText";
import { focusFirstSuggestion, HelpArticleCard, HelpForUnanswered, HelpIntro, HelpSuggestions, ReplyFeedback } from "@/components/CoachHelp";
import { SignalementProvider, useOpenSignalement } from "@/components/Signalement";
import { helpArticle, helpLocale, helpSuggestions, MIN_SUGGESTION_LENGTH, type HelpArticle } from "@/coach-help";
import { createMentions, type Mentions } from "@/help-terms";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Icons } from "@/components/icons";
import { buttonClass } from "@/design/Button";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { AiActivityLiveProvider, useAiActivityLive, type RequestActionLive } from "@/components/AiActivityLive";
import { ProvenanceLine } from "@/components/ProvenanceLine";
import { readNdjson } from "@/ndjson";
import { routes } from "@/routes";
import { formatDuration, formatTokens, isFailureReason, replyActivity, type Activity, type FailureReason, type Provenance, type ProvenanceStep, type StartedStep, type StepLabel } from "@jobhub/shared";

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
  /** The button's words, and its shorter words below 48rem when it has them (« Aide », #342). */
  label: ParseKeys;
  shortLabel?: ParseKeys;
  /** Opens the panel on a Help Article (#342), shown as a card in the conversation; nothing for an unknown id. */
  openHelp: (articleId: string) => void;
  /** Which mention of a glossary term is the page's first (#343); null in a panel without help. */
  mentions: Mentions | null;
  /** The AI Coach replies given here about the object of the page in view (#332). */
  repliesInView: readonly ReplyInView[];
  /** Opens the panel and sends `question`, with the item an Explainable label asks about (#407); null in a panel without them. */
  ask: ((question: string, explained: ExplainedItem) => void) | null;
  /** Puts the focus in the message box. */
  focusBox: () => void;
};

const CoachPanelControl = createContext<Control | null>(null);

/**
 * An AI Coach reply given in this browser while a page's object (an Application, a Job Offer, a Profile, a Job Search, a Job Digest or the Agenda) was In view:
 * AI Activity counts it with that page at once (#332), before the page is next loaded with it.
 */
export type ReplyInView = { provenance: Provenance | null; at: string };
const NO_REPLIES: readonly ReplyInView[] = [];
/** What a reply is kept with as its Focus (coach-conversations, the six kinds In view since #600), so counted with their page. */
const FOCUS_KINDS: ReadonlySet<string> = new Set(["application", "job_offer", "profile", "job_search", "job_digest", "agenda"]);
const focusKey = (inView: InView) => `${inView.kind}:${inView.id}`;

/**
 * Opens the Coach Panel on a Help Article (#342, ADR-0035), shown as a card in the conversation: `openHelp("glossary-ats-score")`.
 * Does nothing outside a Coach Panel (signed-out pages) or in one without help (the Back Office Assistant).
 */
export function useOpenHelp(): (articleId: string) => void {
  return useContext(CoachPanelControl)?.openHelp ?? NO_HELP;
}
const NO_HELP = () => {};

/**
 * What help in pages needs (#343): opening a Help Article in the Coach Panel, and which mention of a glossary term is
 * the page's first. Null outside a Coach Panel (signed-out pages) or in one without help (the Back Office Assistant).
 */
export function usePageHelp(): { openHelp: (articleId: string) => void; mentions: Mentions } | null {
  const control = useContext(CoachPanelControl);
  return control?.mentions ? { openHelp: control.openHelp, mentions: control.mentions } : null;
}

/**
 * Asks the Back Office Assistant about an item, from an Explainable label (#407, ADR-0042): the panel opens and sends
 * `question` with `explained`, the item's context, in the conversation it has open. Null outside the Back Office
 * Assistant (the Candidate's pages have HelpTerms instead).
 */
export function useAskAssistant(): ((question: string, explained: ExplainedItem) => void) | null {
  return useContext(CoachPanelControl)?.ask ?? null;
}

/**
 * Opens the Coach Panel, as « Aide et coach » does (the home page's quick actions, #467); while it is open (and on a
 * page that is a conversation, #601), puts the focus in its message box. Null outside a Coach Panel (signed-out pages).
 */
export function useOpenCoachPanel(): (() => void) | null {
  const control = useContext(CoachPanelControl);
  if (!control) return null;
  return () => {
    if (!control.open) control.toggle();
    else control.focusBox();
  };
}

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
  const { open, panelId, toggle, register, label, shortLabel } = control;
  // While the panel is open its Fermer button closes it: the toggle steps aside (ADR-0024).
  if (open) return null;
  return (
    <button
      ref={register}
      // The Design System's button (#464): « Aide et coach » in the Top Bar, the primary one floating.
      className={floating ? `${buttonClass({ variant: "primary" })} coach-panel-toggle coach-panel-toggle-floating` : `${buttonClass()} coach-panel-toggle`}
      type="button"
      aria-expanded={false}
      aria-controls={panelId}
      onClick={toggle}
    >
      <Icons.coach />
      {shortLabel ? (
        <>
          <span className="coach-panel-toggle-long">{t(label)}</span>
          <span className="coach-panel-toggle-short">{t(shortLabel)}</span>
        </>
      ) : (
        t(label)
      )}
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

/**
 * A Help Article opened in the conversation (#342): a card in this browser only, never saved, gone when the conversation
 * reopens. `answered`: the Candidate said it answered their question.
 */
type HelpCard = { from: "help"; key: number; article: HelpArticle; answered: boolean };

/**
 * A message as the panel shows it, with what this browser alone knows of an AI Coach reply (#345, never saved):
 * `couldNotAnswer`, the AI Coach marked the question as one it could not answer; `satisfied`, the Candidate's « Oui » or « Non ».
 */
type ShownMessage = CoachMessage & { couldNotAnswer?: true; satisfied?: boolean };

/** What the panel lists: the saved messages, the replies stopped and the Help Articles opened since it opened. */
type PanelMessage = ShownMessage | StoppedReply | HelpCard;

const isHelpCard = (message: PanelMessage): message is HelpCard => message.from === "help";

/** A conversation as the panel holds it: its summary (none before it is saved) and the messages shown. */
type Conversation = { conversation: ConversationSummary | null; messages: PanelMessage[] };

/** How long the box waits for the Candidate to stop typing before it looks in the help. */
const SUGGEST_DELAY_MS = 150;

/** A reply on its way, live (#328): the step under way, with its Activity and label, and the tokens spent so far. */
type Live = { step: { activity: Activity; label: StepLabel } | null; tokens: number };

/** What POST /api/coach streams (see its route). */
type LiveEvent =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "step_started"; id: number; step: StartedStep; label: StepLabel }
  | { type: "step_ended"; id: number; step: ProvenanceStep }
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
  /** The AI Coach could not answer the question (#345). */
  couldNotAnswer?: boolean;
};

/** The tokens a step spent: none for one stopped or failed (providers say nothing then). */
const tokensOf = (step: ProvenanceStep) => (step.kind === "ai" && step.tokens ? step.tokens.input + step.tokens.output : 0);

/**
 * A Coach Conversation shown as the page itself (#601, ADR-0070), its box at the foot, rather than in the side panel:
 * `conversationId`, the saved one the page shows (null: a new one, as the home page is); `subject`, a Sidebar menu's
 * (#604): every message goes to that menu's conversation, and the page keeps its address; none for a Free conversation;
 * `introduction`, what the page says after the AI disclosure in its first message (the Introduction); `card`, the menu's
 * content as a card in the thread after it (the list of Applications), which stays; `suggestions`, shown above the box
 * while nothing is sent (the Quick actions).
 */
export type PagePlacement = {
  conversationId: string | null;
  subject?: { kind: "menu"; id: SubjectMenu };
  introduction?: ReactNode;
  card?: ReactNode;
  suggestions?: ReactNode;
};

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
  /** The send button's words. */
  sendLabel: ParseKeys;
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
    /** Help Articles first (#342, ADR-0035): suggested while the Candidate types, opened as cards, offered when the AI cannot answer. */
    help: boolean;
    /** Questions asked from an Explainable label, with the item's context (#407). */
    explain: boolean;
  };
  /**
   * `title`, the panel's visible title, and `badge`, by the message box, say the AI is an AI (AI Act art. 50(1), #324),
   * whatever the width and in every conversation.
   */
  texts: Record<"open" | "title" | "badge" | "welcome" | "thinking" | "unavailable" | "messagesLabel" | "author" | "retention" | "noConversations", ParseKeys> & {
    /** Shown where the Coach Panel says what is in view, for a panel that follows nothing in view. */
    context?: ParseKeys;
    /** The button's shorter words below 48rem. */
    openShort?: ParseKeys;
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
    sendLabel: "coachPanel.send",
    conversations: "/api/coach/conversations",
    storageKey: "jobhub.coachConversation",
    features: { memory: true, inView: true, live: true, help: true, explain: false },
    texts: {
      open: "coachPanel.open",
      openShort: "coachPanel.openShort",
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
    sendLabel: "backOfficeAssistant.send",
    conversations: "/api/admin/assistant/conversations",
    storageKey: "jobhub.backOfficeAssistantConversation",
    features: { memory: false, inView: false, live: false, help: false, explain: true },
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

function remember(storageKey: string | null, conversationId: string | null) {
  if (storageKey === null) return;
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
 * Administrator in the Back Office (see PanelKind). `page`: the same conversation shown as the page itself rather than
 * in the side panel (#601, see CoachConversationPage).
 */
export function CoachPanel({ kind = "coach", page, children }: { kind?: PanelKind; page?: PagePlacement; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  // A Signalement from the panel (#345): only around the Candidate's pages (CandidateCoachPanel).
  const signalement = useOpenSignalement();
  const panel = PANELS[kind];
  const texts = panel.texts;
  const isPage = page !== undefined;
  // A page that is a conversation is its address (#601): this browser does not remember it to reopen it elsewhere.
  const storageKey = isPage ? null : panel.storageKey;
  const conversationFirst = useConversationFirst();
  const pageConversationId = page?.conversationId ?? null;
  // A menu's conversation (#604): its Subject, which every message goes to, and its page's address, which it keeps.
  const pageSubject = page?.subject ?? null;
  const id = useId();
  const pathname = usePathname();
  // AI Activity shows the reply on its way too, with its steps and a stop icon (#333): on the Candidate's pages only.
  const aiActivity = useAiActivityLive();
  // A page that is a conversation is always open.
  const [open, setOpen] = useState(isPage);
  const [inView, setInViewState] = useState<InView | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  // Whether the conversation in view opened with the AI disclosure: a new one does, until it is saved.
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  // A page that shows a saved conversation brings it back first.
  const [restoring, setRestoring] = useState(pageConversationId !== null);
  const [view, setView] = useState<"chat" | "list" | "memory">("chat");
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // Why the last reply failed, its Failure Reason in words (#328), never the technical message.
  const [failure, setFailure] = useState<FailureReason | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  // What a page that is a conversation says of « Effacer » (#601): done, or why not.
  const [pageNotice, setPageNotice] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  // Aborts the reply on its way: the Candidate's Stop.
  const stopper = useRef<AbortController | null>(null);
  const [focusInput, setFocusInput] = useState(0);
  // Counts the page's fresh starts (#601): a reply to a conversation since cleared is dropped.
  const generation = useRef(0);
  const restored = useRef(isPage);
  const toggles = useRef(new Set<HTMLButtonElement>());
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  // A page that is a conversation (#601): its foot, the box, stays at the bottom of the screen over the thread.
  const foot = useRef<HTMLDivElement>(null);
  const setInView = useCallback((next: InView | null) => setInViewState(next), []);
  // Agrandir: the panel widens into a modal drawer over the page (ADR-0024); never remembered.
  const [wide, setWide] = useState(false);
  const focusMoved = useRef(false);
  // The replies given about a page's object, by its focus key, for AI Activity (#332).
  const [repliesGiven, setRepliesGiven] = useState<readonly (ReplyInView & { focus: string })[]>([]);
  const inViewKey = inView ? focusKey(inView) : null;
  const repliesInView = useMemo(() => repliesGiven.filter((reply) => reply.focus === inViewKey), [repliesGiven, inViewKey]);
  // The help (#342): the Help Articles matching the draft, once the Candidate pauses; the one read last, whose title goes
  // with the next message; the question the AI Coach could not answer, for the help to answer instead.
  const help = panel.features.help;
  const openSignalement = help ? signalement : null;
  const locale = helpLocale(i18n.language);
  const [query, setQuery] = useState("");
  const [readArticle, setReadArticle] = useState<{ id: string; title: string } | null>(null);
  const [unanswered, setUnanswered] = useState<string | null>(null);
  const helpCards = useRef(0);
  const [focusCard, setFocusCard] = useState<string | null>(null);
  // Kept for as long as the panel is: a new page starts afresh by itself (#343).
  const [mentions] = useState(createMentions);
  useEffect(() => {
    if (!help) return;
    const timer = setTimeout(() => setQuery(draft), SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [help, draft]);
  const found = useMemo(() => (help ? helpSuggestions(query, locale) : []), [help, query, locale]);
  // A draft cleared (sent) or cut short hides them at once.
  const suggestions = draft.trim().length >= MIN_SUGGESTION_LENGTH ? found : [];

  useEffect(() => {
    const box = input.current;
    if (!open || !box) return;
    // A page that is a conversation leaves the focus where a page load puts it, until something asks for the box.
    if (isPage && focusInput === 0) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [open, focusInput, isPage]);

  // An article opened takes the focus, so it is read out and Escape brings the Candidate back to the box.
  useEffect(() => {
    if (focusCard) document.getElementById(focusCard)?.focus();
  }, [focusCard]);

  // Open, the Coach Panel announces its replies itself: AI Activity leaves them to it (#333).
  const tellAiActivity = aiActivity?.coachPanel;
  // So does a page that is a conversation, while it is shown.
  useEffect(() => {
    tellAiActivity?.(open);
    if (isPage) return () => tellAiActivity?.(false);
  }, [tellAiActivity, open, isPage]);

  // A page that shows a saved conversation brings it back (#601); gone (deleted meanwhile), the page is a new one.
  useEffect(() => {
    if (!pageConversationId) return;
    let shown = true;
    void fetchConversation(panel.conversations, pageConversationId).then((found) => {
      if (!shown) return;
      if ("conversation" in found) {
        const { messages: saved, aiDisclosure: disclosed, ...summary } = found.conversation;
        setConversation(summary);
        setAiDisclosure(disclosed);
        setMessages((opened) => [...saved, ...opened.filter(isHelpCard)]);
      } else if (!pageSubject && window.location.pathname !== routes.home) window.history.replaceState(null, "", routes.home);
      setRestoring(false);
    });
    return () => {
      shown = false;
    };
  }, [panel.conversations, pageConversationId, pageSubject]);

  // A page that is a conversation lets « Effacer » in the Top Bar and the Sidebar act on it while it is shown (#601).
  const pageActions = useRef<{ clear: () => Promise<boolean>; startNew: () => void } | null>(null);
  useEffect(() => {
    pageActions.current = { clear: clearPage, startNew: startAfresh };
  });
  const registerPage = conversationFirst?.setPage;
  const conversationOnPage = conversation?.id ?? null;
  const replying = status === "sending";
  useEffect(() => {
    if (!isPage || !registerPage) return;
    registerPage({
      conversationId: conversationOnPage,
      replying,
      clear: () => pageActions.current?.clear() ?? Promise.resolve(false),
      // A menu's page is not a new Free conversation: « Nouvelle conversation » leads to the home page.
      startNew: pageSubject ? null : () => pageActions.current?.startNew(),
    });
    return () => registerPage(null);
  }, [isPage, registerPage, conversationOnPage, replying, pageSubject]);

  /** Opens the panel; the conversation it reopened the first time, once it is back (null when none came back). */
  async function openPanel(): Promise<Conversation | null> {
    setOpen(true);
    // The first time the panel opens, reopen the conversation this browser had open.
    if (restored.current) return null;
    restored.current = true;
    const conversationId = storageKey ? remembered(storageKey) : null;
    if (!conversationId) return null;
    setRestoring(true);
    const found = await fetchConversation(panel.conversations, conversationId);
    let reopened: Conversation | null = null;
    if ("conversation" in found) {
      const { messages: saved, aiDisclosure: disclosed, ...summary } = found.conversation;
      setConversation(summary);
      setAiDisclosure(disclosed);
      // A Help Article opened meanwhile (the panel opened on it) stays after the saved messages.
      setMessages((shown) => [...saved, ...shown.filter(isHelpCard)]);
      reopened = { conversation: summary, messages: saved };
    } else if (found.gone) remember(storageKey, null);
    setRestoring(false);
    return reopened;
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

  // Escape in the help brings the Candidate back to the message box (#342); elsewhere it brings a widened panel back
  // beside the page first, then closes it.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (event.target instanceof Element && event.target.closest("[data-help]")) {
      event.preventDefault();
      input.current?.focus();
    } else if (wide) setWide(false);
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

  /** Shows a Help Article as a card at the end of the conversation (#342), and gives it the focus. */
  function showArticle(article: HelpArticle) {
    const key = (helpCards.current += 1);
    setMessages((shown) => [...shown, { from: "help", key, article, answered: false }]);
    setReadArticle({ id: article.id, title: article.title });
    setView("chat");
    setFocusCard(`${id}-help-${key}`);
  }

  function openHelp(articleId: string) {
    const article = help ? helpArticle(articleId, locale) : null;
    if (!article) return;
    if (!open) void openPanel();
    showArticle(article);
  }

  /** « Non, demander au coach »: the box starts a question about the article, to finish and send. */
  function askAbout(article: HelpArticle) {
    setDraft(t("coachPanel.help.askAbout", { title: article.title }));
    setReadArticle({ id: article.id, title: article.title });
    setFocusInput((n) => n + 1);
  }

  /** « Poser la question à l'équipe » (#345, ADR-0035): a Question Signalement with the question and the reply that did not satisfy. */
  function askTeam(question: string, coachReply: string) {
    openSignalement?.({ kind: "question", question, coachReply });
  }

  /** The Candidate's « Oui » or « Non » under an AI Coach reply. */
  function answerFeedback(index: number, satisfied: boolean) {
    setMessages((shown) => shown.map((each, at) => (at === index && each.from === "coach" ? { ...each, satisfied } : each)));
  }

  function startNewConversation() {
    setConversation(null);
    setAiDisclosure(true);
    setMessages([]);
    setReadArticle(null);
    setUnanswered(null);
    setStatus("idle");
    remember(storageKey, null);
    showChat();
  }

  /** A page that is a conversation takes the address of the conversation its first message saved, and the Sidebar lists it (#601). */
  function savedOnPage(saved: ConversationSummary) {
    if (!isPage || pageSubject) return;
    conversationFirst?.saved({ id: saved.id, title: saved.title });
    const address = routes.conversation(saved.id);
    if (window.location.pathname !== address) window.history.replaceState(null, "", address);
  }

  /** A page that is a conversation turns into a new Free conversation, the home page (#601); a menu's starts afresh in place (#604). */
  function startAfresh() {
    generation.current += 1;
    stopper.current?.abort();
    startNewConversation();
    setDraft("");
    setPageNotice(null);
    if (!pageSubject && window.location.pathname !== routes.home) window.history.replaceState(null, "", routes.home);
  }

  /**
   * « Effacer » (#601, ADR-0070): deletes every message of the page's conversation, then starts afresh; false when it could not.
   * Never while a reply is on its way: the server saves the Candidate's message when the request ends, even aborted (a Stop),
   * so clearing then would leave it saved, in a conversation this page may not even know yet.
   */
  async function clearPage(): Promise<boolean> {
    if (status === "sending") return false;
    if (conversation) {
      const response = await fetch(`${panel.conversations}/${encodeURIComponent(conversation.id)}`, { method: "DELETE" }).catch(() => null);
      // Already gone (another tab, or purged): cleared either way.
      if (!response?.ok && response?.status !== 404) {
        setPageNotice({ kind: "alert", text: t("coachPanel.listErrors.action") });
        return false;
      }
    }
    startAfresh();
    setPageNotice({ kind: "status", text: t("conversationFirst.cleared") });
    return true;
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
    if (!element || !end) return;
    if (!isPage) {
      element.scrollTop += end.getBoundingClientRect().top - element.getBoundingClientRect().bottom;
      return;
    }
    // A page that is a conversation scrolls as a page: down to its latest message when the box at its foot hides it.
    // Nothing sent yet, it stays at its top, on its Introduction.
    if (messages.length === 0) return;
    const hidden = end.getBoundingClientRect().top - (foot.current?.getBoundingClientRect().top ?? window.innerHeight);
    if (hidden > 0) window.scrollBy(0, hidden);
  }, [messages, status, view, open, isPage]);

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
    remember(storageKey, summary.id);
    showChat();
    return true;
  }

  /**
   * An Explainable label's question (#407): sent at once, in the conversation open, or the one the panel reopens the
   * first time it opens. Nothing while a reply is on its way or a conversation is coming back: the label can be clicked again.
   */
  function ask(question: string, explained: ExplainedItem) {
    setView("chat");
    if (open) {
      if (status !== "sending" && !restoring) void sendMessage(question, explained);
      return;
    }
    void openPanel().then((reopened) => sendMessage(question, explained, reopened ?? undefined));
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft.trim());
  }

  /**
   * Sends `text`, the box's or an Explainable label's question with its item (`explained`), and shows the reply.
   * `reopened`: the conversation the panel has just reopened, when this render does not hold it yet.
   */
  async function sendMessage(text: string, explained?: ExplainedItem, reopened?: Conversation) {
    if (!text || status === "sending" || (restoring && !reopened)) return;
    const { conversation: current, messages: before } = reopened ?? { conversation, messages };
    // What the reply is about, as the server keeps it: counted with that page in AI Activity.
    const about = kind === "coach" && inView && FOCUS_KINDS.has(inView.kind) ? focusKey(inView) : null;
    const shown: PanelMessage[] = [...before, { from: "candidate", text }];
    setMessages(shown);
    setDraft("");
    setStatus("sending");
    setFailure(null);
    setUnanswered(null);
    // The Help Article read last goes with this message only: the AI Coach is told its title (#342).
    const read = help ? readArticle : null;
    const stop = new AbortController();
    stopper.current = stop;
    const startedAt = Date.now();
    let spent = 0;
    // Started afresh meanwhile (« Effacer », « Nouvelle conversation »): what comes back belongs to no conversation shown.
    const startedIn = generation.current;
    const abandoned = () => {
      if (generation.current === startedIn) return false;
      shownLive?.end("stopped");
      return true;
    };
    // The conversation the message goes to, once the server says (a new one is named already): where a Stop keeps it.
    let asked: ConversationSummary | null = current;
    if (panel.features.live) setLive({ step: null, tokens: 0 });
    const shownLive: RequestActionLive | null = panel.features.live && aiActivity ? aiActivity.requestAction("coach_reply", pathname, () => stop.abort()) : null;

    const giveBack = (error: Status, reason?: unknown) => {
      if (abandoned()) return;
      // Give the Candidate their message back to retry or shorten it.
      setMessages(before);
      setDraft(text);
      setStatus(error);
      setFailure(isFailureReason(reason) ? reason : null);
      // The help still answers when the AI Coach cannot (ADR-0035).
      if (help && error === "unavailable") setUnanswered(text);
      shownLive?.end("failed", isFailureReason(reason) ? `failureReasons.${reason}` : null);
    };
    const answered = (body: ReplyBody) => {
      if (abandoned()) return;
      setConversation(body.conversation);
      remember(storageKey, body.conversation.id);
      savedOnPage(body.conversation);
      // A Blocked message (#228): the Guardrail is never named, only that the message or the reply was blocked.
      const blocked = body.blocked;
      setMessages([
        ...before,
        { from: "candidate", text, ...(blocked?.message ? { blocked: true as const } : {}) },
        {
          from: "coach",
          text: body.reply,
          ...(blocked?.reply ? { blocked: true as const } : {}),
          ...(body.jobOffer ? { jobOffer: body.jobOffer } : {}),
          ...(typeof body.at === "string" ? { provenance: body.provenance ?? null, at: body.at } : {}),
          ...(body.couldNotAnswer === true && !blocked?.reply ? { couldNotAnswer: true as const } : {}),
        },
      ]);
      const at = body.at;
      if (about && typeof at === "string") setRepliesGiven((given) => [...given, { focus: about, provenance: body.provenance ?? null, at }]);
      setReadArticle(null);
      setStatus("idle");
      shownLive?.end("done");
    };
    const gone = () => {
      if (abandoned()) return;
      // Deleted meanwhile (another tab, or kept past its 12 months): the message starts a new one.
      setConversation(null);
      setAiDisclosure(true);
      remember(storageKey, null);
      if (isPage && !pageSubject && window.location.pathname !== routes.home) window.history.replaceState(null, "", routes.home);
      setMessages([]);
      setDraft(text);
      setStatus("unavailable");
      shownLive?.end("failed");
    };
    // Stopped (#316 answer 11): the question stays, saved in its conversation; « Réponse arrêtée » stands in for the reply.
    const stopped = (where: ConversationSummary | null) => {
      if (abandoned()) return;
      if (where) {
        setConversation(where);
        remember(storageKey, where.id);
        savedOnPage(where);
      }
      setMessages([...shown, { from: "stopped", tokens: spent, ms: Date.now() - startedAt }]);
      setReadArticle(null);
      setStatus("idle");
      shownLive?.end("stopped");
    };

    try {
      const response = await fetch(panel.send, {
        method: "POST",
        headers: { "content-type": "application/json", ...(panel.features.live ? { accept: "application/x-ndjson" } : {}) },
        // The server holds the conversation: only the new message goes.
        body: JSON.stringify({
          // A menu's page (#604): its Subject's conversation, started by this message if it has none.
          ...(pageSubject ? { subject: pageSubject } : current ? { conversationId: current.id } : {}),
          message: text,
          ...(inView && panel.features.inView ? { focus: { kind: inView.kind, id: inView.id, ...(inView.profileId ? { profileId: inView.profileId } : {}) } } : {}),
          ...(read ? { helpArticle: read } : {}),
          ...(explained && panel.features.explain ? { explained } : {}),
          // The page in view, for a question the help missed (#344): the server keeps its route pattern alone.
          ...(help ? { route: pathname } : {}),
        }),
        signal: stop.signal,
      });
      if (response.ok && response.body && response.headers.get("content-type")?.startsWith("application/x-ndjson")) {
        let ended = false;
        await readNdjson(response.body, (received) => {
          const event = received as LiveEvent;
          if (event.type === "conversation") asked = event.conversation;
          else if (event.type === "step_started") {
            setLive({ step: { activity: event.step.activity, label: event.label }, tokens: spent });
            shownLive?.event({ type: "step_started", id: event.id, step: event.step });
          } else if (event.type === "step_ended") {
            shownLive?.event({ type: "step_ended", id: event.id, step: event.step });
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

  // Why there is no reply, in words.
  const failureText =
    status === "invalid" ? t("coachPanel.errors.invalid") : failure ? t("coachPanel.failed", { reason: t(`failureReasons.${failure}`) }) : t(texts.unavailable);

  const contextText = panel.features.inView || !texts.context ? inViewLabel : t(texts.context);
  const conversationTitle = conversation ? conversation.title : t("coachPanel.newConversation");
  // The conversation's first message: the AI disclosure, or the welcome of a panel without one or of a conversation saved before it.
  const opening = texts.aiDisclosure && aiDisclosure ? texts.aiDisclosure : texts.welcome;

  const control: Control = {
    open,
    panelId: `${id}-panel`,
    toggle: () => (open ? close() : void openPanel()),
    register,
    label: texts.open,
    ...(texts.openShort ? { shortLabel: texts.openShort } : {}),
    openHelp,
    mentions: help ? mentions : null,
    repliesInView,
    ask: panel.features.explain ? ask : null,
    focusBox: () => setFocusInput((n) => n + 1),
  };
  // An empty conversation opens on the help (#342): only Help Articles opened so far, nothing sent.
  const showIntro = help && !restoring && messages.every(isHelpCard);

  // The conversation: its messages, then the reply on its way or why there is none (the panel's body, or the page's thread).
  const thread = (
    <>
      <h3 className="visually-hidden">{conversationTitle}</h3>
      {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
      <ol className="chat coach-panel-messages" aria-label={t(texts.messagesLabel)} aria-live="polite">
        {/* Until a reopened conversation is back, which opening it had is not known yet. */}
        {restoring ? null : (
          <li className="chat-message chat-coach">
            {/* No visible author (#317, #327): screen readers still hear who speaks. */}
            <span className="visually-hidden">{t(texts.author)}</span>
            <p>{t(opening)}</p>
            {page?.introduction}
            {showIntro ? <HelpIntro pathname={pathname} locale={locale} onOpen={showArticle} /> : null}
          </li>
        )}
        {/* A menu's content (#604), a card after the Introduction: it stays whatever is sent. */}
        {page?.card ? <li className="chat-message chat-card">{page.card}</li> : null}
        {messages.map((message, index) =>
          message.from === "help" ? (
            <li key={`help-${message.key}`} className="chat-message chat-help">
              <HelpArticleCard
                article={message.article}
                headingId={`${id}-help-${message.key}`}
                answered={message.answered}
                onAnswered={() => setMessages((shown) => shown.map((each) => (isHelpCard(each) && each.key === message.key ? { ...each, answered: true } : each)))}
                onAskCoach={() => askAbout(message.article)}
              />
            </li>
          ) : message.from === "stopped" ? (
            <li key={index} className="chat-message chat-coach chat-stopped">
              <span className="visually-hidden">{t(texts.author)}</span>
              <StoppedReplyLine reply={message} />
            </li>
          ) : (
          <li key={index} className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}${message.blocked ? " chat-blocked" : ""}`}>
            <span className="visually-hidden">{message.from === "coach" ? t(texts.author) : t("questionnaire.you")}</span>
            {/* A reply is unframed text after the glyph of what it did last (#464); the Candidate's words, a bubble. */}
            {message.from === "coach" ? <ActivityGlyph activity={replyActivity(message.provenance ?? null)} /> : null}
            {message.blocked ? <span className="chat-blocked-label">{t("coachPanel.blocked")}</span> : null}
            {message.from === "coach" ? <CoachReplyText text={message.text} /> : <p>{message.text}</p>}
            {message.jobOffer ? <JobOfferCard jobOffer={message.jobOffer} /> : null}
            {message.from === "coach" && message.at ? <ProvenanceLine provenance={message.provenance ?? null} at={message.at} /> : null}
            {openSignalement && message.from === "coach" && !message.blocked && !message.jobOffer ? (
              <ReplyFeedback
                couldNotAnswer={message.couldNotAnswer === true}
                satisfied={message.satisfied}
                onAnswer={(satisfied) => answerFeedback(index, satisfied)}
                onAskTeam={() => askTeam(questionBefore(messages, index), message.text)}
              />
            ) : null}
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
              <ActivityGlyph activity={live.step.activity} live />
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
          {failureText}
        </p>
      ) : null}
      {status === "unavailable" && unanswered !== null ? (
        <HelpForUnanswered
          question={unanswered}
          locale={locale}
          onOpen={showArticle}
          // The team, directly: the AI Coach's unavailable message stands for its reply (#345).
          {...(openSignalement ? { onAskTeam: () => askTeam(unanswered, failureText) } : {})}
        />
      ) : null}
      <div ref={messagesEnd} aria-hidden="true" />
      {conversation && panel.features.memory ? <CoachMemoryProposals key={conversation.id} conversationId={conversation.id} /> : null}
    </>
  );

  // The message box, Send (« Arrêter » while a reply is on its way) and the « Coach IA » badge in it, and what goes with the message.
  const composer = (
    <form className="coach-panel-form" onSubmit={send}>
      {help ? (
        <>
          <HelpSuggestions articles={suggestions} onOpen={showArticle} onBack={() => input.current?.focus()} />
          {/* « 2 articles dans l'aide »: heard as they change, never moving the focus. */}
          <p className="visually-hidden" aria-live="polite">
            {suggestions.length > 0 ? t("coachPanel.help.found", { count: suggestions.length }) : ""}
          </p>
        </>
      ) : null}
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
            // ↓ at the end of the draft goes to the help's suggestions (#342).
            const box = event.currentTarget;
            if (event.key === "ArrowDown" && suggestions.length > 0 && box.selectionStart === box.value.length && focusFirstSuggestion(box)) {
              event.preventDefault();
              return;
            }
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
            <button key="send" className={buttonClass()} type="button" onClick={() => stopper.current?.abort()}>
              {t("coachPanel.stop")}
            </button>
          ) : (
            <button key="send" className={buttonClass({ variant: "primary" })} type="submit" disabled={status === "sending" || restoring}>
              {t(panel.sendLabel)}
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
            <StartJobSearchButton key={profileIdOf(inView)} profileId={profileIdOf(inView)!} label={t("coachPanel.searchJobs")} variant="secondary" />
          ) : (
            <p className="hint">{t("coachPanel.searchHint")}</p>
          )}
        </div>
      </details>
    </form>
  );

  // « Signaler un problème », « Proposer une idée » (#345): under the box, from every view.
  const teamLinks = openSignalement ? (
    // The panel's foot (#345): a Bug or an Idée, from every view; on phones, with the drawer's icon, the way in.
    <nav className="coach-panel-foot" aria-label={t("coachPanel.team.foot")}>
      <button type="button" className="link-action" onClick={() => openSignalement({ kind: "type", type: "bug" })}>
        {t("coachPanel.team.reportProblem")}
      </button>
      <button type="button" className="link-action" onClick={() => openSignalement({ kind: "type", type: "idee" })}>
        {t("coachPanel.team.suggestIdea")}
      </button>
    </nav>
  ) : null;

  if (page) {
    // A page that is a conversation (#601, ADR-0070): the thread at its reading width, centred, the box at the page's foot,
    // the suggestions above it while nothing is sent.
    const showSuggestions = !restoring && page.suggestions !== undefined && messages.every(isHelpCard);
    return (
      <SetInView.Provider value={setInView}>
        <CoachPanelControl.Provider value={control}>
          <section
            className="page-conversation"
            aria-label={t("conversationFirst.label")}
            onKeyDown={(event) => {
              // Escape in the help brings the Candidate back to the message box (#342).
              if (event.key === "Escape" && event.target instanceof Element && event.target.closest("[data-help]")) {
                event.preventDefault();
                input.current?.focus();
              }
            }}
          >
            <div className="page-conversation-thread" ref={body}>
              {thread}
            </div>
            <div className="page-conversation-foot" ref={foot}>
              <div role="status">{pageNotice?.kind === "status" ? <p className="notice">{pageNotice.text}</p> : null}</div>
              {pageNotice?.kind === "alert" ? (
                <p className="notice" role="alert">
                  {pageNotice.text}
                </p>
              ) : null}
              {showSuggestions ? (
                <div className="page-conversation-suggestions" role="group" aria-label={t("conversationFirst.suggestions")}>
                  {page.suggestions}
                </div>
              ) : null}
              {composer}
              {teamLinks}
            </div>
          </section>
        </CoachPanelControl.Provider>
      </SetInView.Provider>
    );
  }

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
                      remember(storageKey, null);
                    }
                  }}
                />
              </div>
            ) : (
              <>
                <div className="coach-panel-body" ref={body}>
                  {thread}
                </div>
                {composer}
              </>
            )}
            {teamLinks}
          </aside>
        ) : null}
        <CoachPanelToggle floating />
      </CoachPanelControl.Provider>
    </SetInView.Provider>
  );
}

/**
 * A Coach Conversation that is the page itself (#601, ADR-0070), under « Conversation au centre »: the home page's new
 * Free conversation, or a saved one (`conversationId`). The thread at its reading width, centred; the box at the page's
 * foot with the « Coach IA » badge, « Arrêter » while a reply is on its way, the Signalement links under it; each reply
 * with its Provenance line and « Cela répond à votre question ? ». Its first message saved, the page takes the
 * conversation's address and the Sidebar lists it; « Effacer » in the Top Bar clears it. Key it by `conversationId`.
 */
export function CoachConversationPage(placement: PagePlacement) {
  return <CoachPanel page={placement}>{null}</CoachPanel>;
}

/**
 * The Candidate's Coach Panel around every page but the Back Office's, whose
 * pages carry the Back Office Assistant instead (BackOfficeLayout): only one
 * panel is ever mounted.
 */
export function CandidateCoachPanel({ version, children }: { version: string; children: ReactNode }) {
  const pathname = usePathname();
  const inBackOffice = pathname === routes.admin || pathname.startsWith(`${routes.admin}/`);
  return inBackOffice ? (
    children
  ) : (
    <AiActivityLiveProvider>
      {/* The Coach Panel's Signalements (#345): `version`, the Jobbbox version the dialog's detail shows. */}
      <SignalementProvider version={version}>
        <CoachPanel>{children}</CoachPanel>
      </SignalementProvider>
    </AiActivityLiveProvider>
  );
}

/** The Candidate's message an AI Coach reply answers: the one just before it. */
function questionBefore(messages: readonly PanelMessage[], index: number): string {
  for (let at = index - 1; at >= 0; at--) {
    const message = messages[at]!;
    if (message.from === "candidate") return message.text;
    if (message.from === "coach") break;
  }
  return "";
}
