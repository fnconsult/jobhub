"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CoachFocus } from "@/coach";
import type { CoachMessage, ConversationContext, JobOfferCard as JobOfferCardData } from "@/coach/conversation";
import type { SubjectRef } from "@/coach-conversations";
import { helpArticle, helpLocale, helpSuggestions, MIN_SUGGESTION_LENGTH, type HelpArticle } from "@/coach-help";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { useAiActivityLive, type RequestActionLive } from "@/components/AiActivityLive";
import { fetchConversation } from "@/components/chat-conversation";
import type { ConversationSummary } from "@/components/CoachConversationList";
import { focusFirstSuggestion, HelpForUnanswered, HelpIntro, HelpSuggestions, ReplyFeedback } from "@/components/CoachHelp";
import { CoachMemoryProposals } from "@/components/CoachMemory";
import { CoachReplyText } from "@/components/CoachReplyText";
import { useConversationFirst } from "@/components/conversation-first";
import { Icons } from "@/components/icons";
import { StartJobSearchButton } from "@/components/JobSearchControls";
import { ProvenanceLine } from "@/components/ProvenanceLine";
import { useOpenSignalement } from "@/components/Signalement";
import { askedAbout, useWorkPane } from "@/components/work-pane";
import { buttonClass } from "@/design/Button";
import { readNdjson } from "@/ndjson";
import { routes } from "@/routes";
import { formatDuration, formatTokens, isFailureReason, replyActivity, type Activity, type FailureReason, type Provenance, type ProvenanceStep, type StartedStep, type StepLabel } from "@jobhub/shared";

/**
 * What a page shows, as its conversation tells the AI Coach with each message.
 * `profileId`: the Profile a Job Search, Job Digest or Application page shows, so the AI Coach can search for it.
 */
export type InView = CoachFocus & { name: string; profileId?: string };

/**
 * An AI Coach reply given in this browser about the page's object (an Application, a Profile, a Job Search, a Job Digest
 * or the Agenda): AI Activity counts it with that page at once (#332), before the page is next loaded with it.
 */
export type ReplyInView = { provenance: Provenance | null; at: string };

/** What the suggestions above the box need from the page's conversation. */
type Control = {
  /** Puts the focus in the message box. */
  focusBox: () => void;
  /** Sends `text` in the page's conversation (a suggestion, #603). */
  say: (text: string) => void;
};

const BoxControl = createContext<Control | null>(null);

/**
 * Sends a message to the AI Coach in the conversation the page is (#603): an object's suggestion. Null outside a page
 * that is a conversation. Does nothing while a reply is on its way or the conversation is coming back.
 */
export function useAskCoach(): ((text: string) => void) | null {
  return useContext(BoxControl)?.say ?? null;
}

/** Puts the focus in the page's message box (the home page's Quick actions, #467). Null outside a page that is a conversation. */
export function useFocusCoachBox(): (() => void) | null {
  return useContext(BoxControl)?.focusBox ?? null;
}

/** What a reply is kept with as its Focus (coach-conversations, the six kinds In view since #600), so counted with their page. */
const FOCUS_KINDS: ReadonlySet<string> = new Set(["application", "job_offer", "profile", "job_search", "job_digest", "agenda"]);

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
 * A message as the page shows it, with what this browser alone knows of an AI Coach reply (#345, never saved):
 * `couldNotAnswer`, the AI Coach marked the question as one it could not answer; `satisfied`, the Candidate's « Oui » or « Non ».
 */
type ShownMessage = CoachMessage & { couldNotAnswer?: true; satisfied?: boolean };

/** What the thread lists: the saved messages and the replies stopped since the page opened. */
type ThreadMessage = ShownMessage | StoppedReply;

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
  | { type: "stopped"; conversation: ConversationSummary; context?: ConversationContext }
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
  /** The conversation's Context bar's figures, once the message is saved (#607). */
  context?: ConversationContext;
};

const SEND = "/api/coach";
const CONVERSATIONS = "/api/coach/conversations";

/** The tokens a step spent: none for one stopped or failed (providers say nothing then). */
const tokensOf = (step: ProvenanceStep) => (step.kind === "ai" && step.tokens ? step.tokens.input + step.tokens.output : 0);

/**
 * Where a Coach Conversation is the page (#601, ADR-0070): `conversationId`, the saved one the page shows (null: a new
 * one, the home page's Free conversation or an object's before its first message); `subject`, the object the conversation
 * is about (#603) or a Sidebar menu's (#604), whose page it is: its page keeps its address, and an object's first message
 * starts it; none for a Free conversation; `inView`, what goes with each message as the page's object; `introduction`,
 * what the page says after the AI disclosure in its first message (the Introduction); `card`, the menu's content as a card
 * in the thread after it (the list of Applications), which stays; `suggestions`, shown above the box while nothing is sent
 * (the Quick actions, an object's suggestions).
 */
export type PagePlacement = {
  conversationId: string | null;
  subject?: SubjectRef;
  inView?: InView;
  introduction?: ReactNode;
  card?: ReactNode;
  suggestions?: ReactNode;
};

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

/**
 * A Coach Conversation that is the page itself (#601, ADR-0070): the home page's new Free conversation, a saved Free
 * conversation, an object's (#603) or a Sidebar menu's (#604). The thread at its reading width, centred; the box at the
 * page's foot with the « Coach IA » badge, « Arrêter » while a reply is on its way, the help's articles while the
 * Candidate types and the Signalement links under it; each reply with its Provenance line and « Cela répond à votre
 * question ? ». A Help Article and a Signalement's form open in the Work Pane (#602). A Free conversation's first message
 * saved, the page takes the conversation's address and the Sidebar lists it; « Effacer » in the Top Bar clears it.
 * Key it by `conversationId`.
 */
export function CoachConversationPage(page: PagePlacement) {
  const { t, i18n } = useTranslation();
  const openSignalement = useOpenSignalement();
  const conversationFirst = useConversationFirst();
  const workPane = useWorkPane();
  const pageConversationId = page.conversationId;
  // An object's conversation (#603) or a menu's (#604): its page keeps its address, and the Sidebar never lists it among
  // the Free ones.
  const subject = page.subject ?? null;
  const inView = page.inView ?? null;
  const id = useId();
  const pathname = usePathname();
  // AI Activity shows the reply on its way too, with its steps and a stop icon (#333).
  const aiActivity = useAiActivityLive();
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  // Its Context bar's figures, as the server says them (#607): none until it is saved.
  const [context, setContext] = useState<ConversationContext | null>(null);
  // Whether the conversation opened with the AI disclosure: a new one does, until it is saved.
  const [aiDisclosure, setAiDisclosure] = useState(true);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  // A page that shows a saved conversation brings it back first.
  const [restoring, setRestoring] = useState(pageConversationId !== null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // Why the last reply failed, its Failure Reason in words (#328), never the technical message.
  const [failure, setFailure] = useState<FailureReason | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  // What the page says of « Effacer » (#601): done, or why not.
  const [notice, setNotice] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  // Aborts the reply on its way: the Candidate's Stop.
  const stopper = useRef<AbortController | null>(null);
  const [focusInput, setFocusInput] = useState(0);
  // Counts the page's fresh starts (#601): a reply to a conversation since cleared is dropped.
  const generation = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  // Its foot, the box, stays at the bottom of the screen over the thread.
  const foot = useRef<HTMLDivElement>(null);
  // The replies given about the page's object, for AI Activity (#332).
  const [repliesInView, setRepliesInView] = useState<readonly ReplyInView[]>([]);
  // The help (#342): the Help Articles matching the draft, once the Candidate pauses; the one read last, whose title goes
  // with the next message; the question the AI Coach could not answer, for the help to answer instead.
  const locale = helpLocale(i18n.language);
  const [query, setQuery] = useState("");
  const [readArticle, setReadArticle] = useState<{ id: string; title: string } | null>(null);
  const [unanswered, setUnanswered] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(draft), SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);
  const found = useMemo(() => helpSuggestions(query, locale), [query, locale]);
  // A draft cleared (sent) or cut short hides them at once.
  const suggestions = draft.trim().length >= MIN_SUGGESTION_LENGTH ? found : [];

  // The Help Article open in the Work Pane, from wherever (a HelpTerm too), is read: while it is open its title goes
  // with each message, unless the Candidate asked about another one (#602).
  const inPane = workPane?.item?.kind === "help" ? workPane.item.article : null;

  useEffect(() => {
    const box = input.current;
    // The focus stays where a page load puts it, until something asks for the box.
    if (!box || focusInput === 0) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [focusInput]);

  // Shown, the conversation announces its replies itself: AI Activity leaves them to it (#333).
  const tellAiActivity = aiActivity?.conversationShown;
  useEffect(() => {
    tellAiActivity?.(true);
    return () => tellAiActivity?.(false);
  }, [tellAiActivity]);

  // A page that shows a saved conversation brings it back (#601); gone (deleted meanwhile), the page is a new one.
  useEffect(() => {
    if (!pageConversationId) return;
    let shown = true;
    void fetchConversation(CONVERSATIONS, pageConversationId).then((found) => {
      if (!shown) return;
      if ("conversation" in found) {
        const { messages: saved, aiDisclosure: disclosed, context: savedContext, ...summary } = found.conversation;
        setConversation(summary);
        setContext(savedContext);
        setAiDisclosure(disclosed);
        setMessages(saved);
      } else if (!subject && window.location.pathname !== routes.home) window.history.replaceState(null, "", routes.home);
      setRestoring(false);
    });
    return () => {
      shown = false;
    };
  }, [pageConversationId, subject]);

  // « Effacer » in the Top Bar and the Sidebar act on the page's conversation while it is shown (#601), and « Demander au
  // coach » in the Work Pane (#602).
  const pageActions = useRef<{ clear: () => Promise<boolean>; startNew: () => void; askAbout: (article: { id: string; title: string }) => void } | null>(null);
  useEffect(() => {
    pageActions.current = { clear: clearPage, startNew: startAfresh, askAbout };
  });

  // « Demander au coach » from a page without a conversation (Mon compte, #602) leads here, the article named in the
  // address: the box starts a question about it, and the address drops it.
  useEffect(() => {
    const asked = askedAbout(window.location.search);
    const article = asked ? helpArticle(asked, locale) : null;
    if (!asked) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (article) pageActions.current?.askAbout({ id: article.id, title: article.title });
    // Once, as the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const registerPage = conversationFirst?.setPage;
  const conversationOnPage = conversation?.id ?? null;
  const replying = status === "sending";
  useEffect(() => {
    if (!registerPage) return;
    registerPage({
      conversationId: conversationOnPage,
      replying,
      context,
      repliesInView,
      clear: () => pageActions.current?.clear() ?? Promise.resolve(false),
      // An object's or a menu's page is not a new Free conversation: « Nouvelle conversation » leads to the home page.
      startNew: subject ? null : () => pageActions.current?.startNew(),
      askAbout: (article) => pageActions.current?.askAbout(article),
    });
    return () => registerPage(null);
  }, [registerPage, conversationOnPage, replying, subject, context, repliesInView]);

  /** A Help Article, from the help's suggestions or the Introduction: in the Work Pane, beside the conversation (#602). */
  function showArticle(article: HelpArticle) {
    workPane?.open({ kind: "help", article });
  }

  /** « Demander au coach » in the Work Pane: the box starts a question about the article, to finish and send. */
  function askAbout(article: { id: string; title: string }) {
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

  /** The page takes the address of the Free conversation its first message saved, and the Sidebar lists it (#601). */
  function savedOnPage(saved: ConversationSummary) {
    if (subject) return;
    conversationFirst?.saved({ id: saved.id, title: saved.title });
    const address = routes.conversation(saved.id);
    if (window.location.pathname !== address) window.history.replaceState(null, "", address);
  }

  /** The page turns into a new Free conversation, the home page (#601); an object's or a menu's starts afresh in place (#603, #604). */
  function startAfresh() {
    generation.current += 1;
    stopper.current?.abort();
    setConversation(null);
    setContext(null);
    setAiDisclosure(true);
    setMessages([]);
    setReadArticle(null);
    setUnanswered(null);
    setStatus("idle");
    setDraft("");
    setNotice(null);
    setFocusInput((n) => n + 1);
    if (!subject && window.location.pathname !== routes.home) window.history.replaceState(null, "", routes.home);
  }

  /**
   * « Effacer » (#601, ADR-0070): deletes every message of the page's conversation, then starts afresh; false when it could not.
   * Never while a reply is on its way: the server saves the Candidate's message when the request ends, even aborted (a Stop),
   * so clearing then would leave it saved, in a conversation this page may not even know yet.
   */
  async function clearPage(): Promise<boolean> {
    if (status === "sending") return false;
    if (conversation) {
      const response = await fetch(`${CONVERSATIONS}/${encodeURIComponent(conversation.id)}`, { method: "DELETE" }).catch(() => null);
      // Already gone (another tab, or purged): cleared either way.
      if (!response?.ok && response?.status !== 404) {
        setNotice({ kind: "alert", text: t("coachPanel.listErrors.action") });
        return false;
      }
    }
    startAfresh();
    setNotice({ kind: "status", text: t("conversationFirst.cleared") });
    return true;
  }

  // The page scrolls as a page: down to its latest message when the box at its foot hides it. Nothing sent yet, it stays
  // at its top, on its Introduction.
  useEffect(() => {
    const end = messagesEnd.current;
    if (!end || messages.length === 0) return;
    const hidden = end.getBoundingClientRect().top - (foot.current?.getBoundingClientRect().top ?? window.innerHeight);
    if (hidden > 0) window.scrollBy(0, hidden);
  }, [messages, status]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft.trim());
  }

  /** Sends `text`, the box's or a suggestion's, and shows the reply as it comes. */
  async function sendMessage(text: string) {
    if (!text || status === "sending" || restoring) return;
    const before = messages;
    const current = conversation;
    // What the reply is about, as the server keeps it: counted with that page in AI Activity.
    const about = inView !== null && FOCUS_KINDS.has(inView.kind);
    const shown: ThreadMessage[] = [...before, { from: "candidate", text }];
    setMessages(shown);
    setDraft("");
    setStatus("sending");
    setFailure(null);
    setUnanswered(null);
    // The Help Article read last goes with this message only: the AI Coach is told its title (#342).
    const read = readArticle ?? (inPane ? { id: inPane.id, title: inPane.title } : null);
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
    setLive({ step: null, tokens: 0 });
    const shownLive: RequestActionLive | null = aiActivity ? aiActivity.requestAction("coach_reply", pathname, () => stop.abort()) : null;

    const giveBack = (error: Status, reason?: unknown) => {
      if (abandoned()) return;
      // Give the Candidate their message back to retry or shorten it.
      setMessages(before);
      setDraft(text);
      setStatus(error);
      setFailure(isFailureReason(reason) ? reason : null);
      // The help still answers when the AI Coach cannot (ADR-0035).
      if (error === "unavailable") setUnanswered(text);
      shownLive?.end("failed", isFailureReason(reason) ? `failureReasons.${reason}` : null);
    };
    const answered = (body: ReplyBody) => {
      if (abandoned()) return;
      setConversation(body.conversation);
      if (body.context) setContext(body.context);
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
      if (about && typeof at === "string") setRepliesInView((given) => [...given, { provenance: body.provenance ?? null, at }]);
      setReadArticle(null);
      setStatus("idle");
      shownLive?.end("done");
    };
    const gone = () => {
      if (abandoned()) return;
      // Deleted meanwhile (another tab, or kept past its 12 months): the message starts a new one.
      setConversation(null);
      setContext(null);
      setAiDisclosure(true);
      if (!subject && window.location.pathname !== routes.home) window.history.replaceState(null, "", routes.home);
      setMessages([]);
      setDraft(text);
      setStatus("unavailable");
      shownLive?.end("failed");
    };
    // Stopped (#316 answer 11): the question stays, saved in its conversation; « Réponse arrêtée » stands in for the reply.
    const stopped = (where: ConversationSummary | null, saved?: ConversationContext) => {
      if (abandoned()) return;
      if (saved) setContext(saved);
      if (where) {
        setConversation(where);
        savedOnPage(where);
      }
      setMessages([...shown, { from: "stopped", tokens: spent, ms: Date.now() - startedAt }]);
      setReadArticle(null);
      setStatus("idle");
      shownLive?.end("stopped");
    };

    try {
      const response = await fetch(SEND, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        // The server holds the conversation: only the new message goes.
        body: JSON.stringify({
          // A menu's page (#604): its Subject's conversation, started by this message if it has none. An object's, before
          // its first message: that message starts it (#603).
          ...(subject?.kind === "menu" ? { subject } : current ? { conversationId: current.id } : subject ? { subject } : {}),
          message: text,
          ...(inView ? { focus: { kind: inView.kind, id: inView.id, ...(inView.profileId ? { profileId: inView.profileId } : {}) } } : {}),
          ...(read ? { helpArticle: read } : {}),
          // The page in view, for a question the help missed (#344): the server keeps its route pattern alone.
          route: pathname,
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
            else if (event.type === "stopped") stopped(event.conversation, event.context);
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

  const inViewLabel = inView ? t("coachPanel.inView", { label: t(IN_VIEW_LABEL[inView.kind], { name: inView.name }) }) : t("coachPanel.nothingInView");

  // Why there is no reply, in words.
  const failureText = status === "invalid" ? t("coachPanel.errors.invalid") : failure ? t("coachPanel.failed", { reason: t(`failureReasons.${failure}`) }) : t("coachPanel.errors.unavailable");

  const conversationTitle = conversation ? conversation.title : t("coachPanel.newConversation");
  // The conversation's first message: the AI disclosure, or the welcome of a conversation saved before it.
  const opening = aiDisclosure ? "coachPanel.aiDisclosure" : "coachPanel.welcome";

  const control: Control = { focusBox: () => setFocusInput((n) => n + 1), say: (text: string) => void sendMessage(text) };
  // An empty conversation opens on the help (#342): nothing sent.
  const showIntro = !restoring && messages.length === 0;
  const intro = showIntro ? <HelpIntro pathname={pathname} locale={locale} onOpen={showArticle} howThisPageWorks={workPane !== null} /> : null;
  // The help's articles, while the Candidate types, take the suggestions' place (#602).
  const showSuggestions = !restoring && page.suggestions !== undefined && messages.length === 0 && suggestions.length === 0;

  return (
    <BoxControl.Provider value={control}>
      {/* The conversation, the page's main region (#608): its thread at its reading width, centred, the box at the page's foot. */}
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
        <div className="page-conversation-thread">
          <h3 className="visually-hidden">{conversationTitle}</h3>
          {restoring ? <p role="status">{t("coachPanel.loading")}</p> : null}
          {/* Replies are announced as they come (#608): the thread is a polite live region. */}
          <ol className="chat coach-panel-messages" aria-label={t("coachPanel.messagesLabel")} aria-live="polite">
            {/* Until a reopened conversation is back, which opening it had is not known yet. */}
            {restoring ? null : (
              <li className="chat-message chat-coach">
                {/* No visible author (#317, #327): screen readers still hear who speaks. */}
                <span className="visually-hidden">{t("questionnaire.coach")}</span>
                <p>{t(opening)}</p>
                {page.introduction}
                {page.card ? null : intro}
              </li>
            )}
            {/* A menu's content (#604), a card after the Introduction: it stays whatever is sent; the help comes after it. */}
            {page.card ? <li className="chat-message chat-card">{page.card}</li> : null}
            {page.card && intro ? (
              <li className="chat-message chat-coach">
                <span className="visually-hidden">{t("questionnaire.coach")}</span>
                {intro}
              </li>
            ) : null}
            {messages.map((message, index) =>
              message.from === "stopped" ? (
                <li key={index} className="chat-message chat-coach chat-stopped">
                  <span className="visually-hidden">{t("questionnaire.coach")}</span>
                  <StoppedReplyLine reply={message} />
                </li>
              ) : (
                <li key={index} className={`chat-message ${message.from === "coach" ? "chat-coach" : "chat-candidate"}${message.blocked ? " chat-blocked" : ""}`}>
                  <span className="visually-hidden">{message.from === "coach" ? t("questionnaire.coach") : t("questionnaire.you")}</span>
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
                {t("coachPanel.thinking")}
              </p>
              {live.step ? (
                <p className="coach-panel-step">
                  <ActivityGlyph activity={live.step.activity} live />
                  {t(`aiActivity.steps.${live.step.label}`)}
                </p>
              ) : null}
            </>
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
          {conversation ? <CoachMemoryProposals key={conversation.id} conversationId={conversation.id} /> : null}
        </div>
        <div className="page-conversation-foot" ref={foot}>
          <div role="status">{notice?.kind === "status" ? <p className="notice">{notice.text}</p> : null}</div>
          {notice?.kind === "alert" ? (
            <p className="notice" role="alert">
              {notice.text}
            </p>
          ) : null}
          {showSuggestions ? (
            <div className="page-conversation-suggestions" role="group" aria-label={t("conversationFirst.suggestions")}>
              {page.suggestions}
            </div>
          ) : null}
          {/* The message box, Send (« Arrêter » while a reply is on its way) and the « Coach IA » badge in it, and what goes with the message. */}
          <form className="coach-panel-form" onSubmit={send}>
            <HelpSuggestions articles={suggestions} onOpen={showArticle} onBack={() => input.current?.focus()} />
            {/* « 2 articles dans l'aide »: heard as they change, never moving the focus. */}
            <p className="visually-hidden" aria-live="polite">
              {suggestions.length > 0 ? t("coachPanel.help.found", { count: suggestions.length }) : ""}
            </p>
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
                  {t("coachPanel.badge")}
                </span>
                {/* While a reply is on its way « Envoyer » becomes « Arrêter » (#328), the same button, so focus stays on it. */}
                {status === "sending" ? (
                  <button key="send" className={buttonClass()} type="button" onClick={() => stopper.current?.abort()}>
                    {t("coachPanel.stop")}
                  </button>
                ) : (
                  <button key="send" className={buttonClass({ variant: "primary" })} type="submit" disabled={restoring}>
                    {t("coachPanel.send")}
                  </button>
                )}
              </div>
            </div>
            {/* What goes with the message: one line, opened for the whole text (and the Job Search). */}
            <details className="coach-panel-context">
              <summary>
                <Icons.coach />
                <span className="coach-panel-context-line">{inViewLabel}</span>
              </summary>
              <div className="coach-panel-context-more">
                <p className="coach-panel-in-view">{inViewLabel}</p>
                {profileIdOf(inView) ? (
                  <StartJobSearchButton key={profileIdOf(inView)} profileId={profileIdOf(inView)!} label={t("coachPanel.searchJobs")} variant="secondary" />
                ) : (
                  <p className="hint">{t("coachPanel.searchHint")}</p>
                )}
              </div>
            </details>
          </form>
          {/* « Signaler un problème », « Proposer une idée » (#345): under the box; their form opens in the Work Pane. */}
          {openSignalement ? (
            <nav className="coach-panel-foot" aria-label={t("coachPanel.team.foot")}>
              <button type="button" className="link-action" onClick={() => openSignalement({ kind: "type", type: "bug" })}>
                {t("coachPanel.team.reportProblem")}
              </button>
              <button type="button" className="link-action" onClick={() => openSignalement({ kind: "type", type: "idee" })}>
                {t("coachPanel.team.suggestIdea")}
              </button>
            </nav>
          ) : null}
        </div>
      </section>
    </BoxControl.Provider>
  );
}

/** The Candidate's message an AI Coach reply answers: the one just before it. */
function questionBefore(messages: readonly ThreadMessage[], index: number): string {
  for (let at = index - 1; at >= 0; at--) {
    const message = messages[at]!;
    if (message.from === "candidate") return message.text;
    if (message.from === "coach") break;
  }
  return "";
}
