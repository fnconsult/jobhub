import { isFailureReason, type FailureReason, type Provenance } from "@jobhub/shared";
import { coachConversationResponseSchema } from "@jobhub/shared/reads";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../api/api";
import { readKey } from "../offline/read-cache";
import { useConversationHandoff } from "./page-conversation";
import { askCoach, type CoachProposalCard, type CoachReply, type ConversationContext, type ConversationSummary, type Live, type SubjectRef } from "./coach-reply";

/** A message of the thread: the Candidate's, or the AI Coach's reply with what the app alone knows of it (#345, never saved). */
export type ShownMessage =
  | { from: "candidate"; text: string; blocked?: true }
  | {
      from: "coach";
      text: string;
      blocked?: true;
      provenance?: Provenance | null;
      at?: string;
      jobOffer?: CoachReply["jobOffer"];
      cards?: CoachProposalCard[];
      /** The AI Coach marked the question as one it could not answer. */
      couldNotAnswer?: true;
      /** The Candidate's « Oui » or « Non » under it. */
      satisfied?: boolean;
    }
  /** A reply the Candidate stopped, with what it had spent, until the conversation reopens. */
  | { from: "stopped"; tokens: number; ms: number };

/** Where the reply stands: on its way, or why there is none (`failed`: unavailable, with its Failure Reason if any). */
export type ReplyStatus =
  | { kind: "idle" }
  | { kind: "sending"; live: Live }
  | { kind: "failed"; reason: FailureReason | null; question: string }
  | { kind: "invalid"; question: string };

/** What the page's conversation has given since it opened, for Activité: each reply's Provenance and when it was saved. */
export type ReplyOnPage = { provenance: Provenance | null; at: string };

export type CoachConversationState = {
  /** A saved conversation coming back. */
  restoring: boolean;
  conversation: ConversationSummary | null;
  context: ConversationContext | null;
  /** Whether it opened with the AI disclosure: a new one does. */
  aiDisclosure: boolean;
  messages: readonly ShownMessage[];
  status: ReplyStatus;
  repliesOnPage: readonly ReplyOnPage[];
};

/** What one outcome makes the Coach say to VoiceOver or TalkBack, once (never the reply word by word). */
export type Announce = (outcome: { kind: "reply"; text: string } | { kind: "stopped" } | { kind: "failed"; status: ReplyStatus }) => void;

/**
 * A page's Coach Conversation (ADR-0070), as the web's CoachConversationPage keeps it: the saved one brought back (by
 * its id, or its Subject's), the Candidate's messages sent to `POST /api/coach` and the replies read from its stream,
 * « Arrêter », the failure with the message given back, « Effacer », and the « Oui » / « Non » under a reply. The first
 * message of a new Free conversation saves it: `onSaved` then gives the page its address, and the drawer's list is read again.
 * That opens the conversation's page, a new screen, where the web only rewrites the address: the page as it stands goes to
 * it (the shell's handoff), since the server never stores « Réponse arrêtée », `couldNotAnswer` or the replies on the page.
 */
export function useCoachConversation({
  conversationId,
  subject,
  route,
  onSaved,
  announce,
}: {
  conversationId: string | null;
  subject?: SubjectRef;
  route: string;
  onSaved?: (conversation: ConversationSummary) => void;
  announce: Announce;
}) {
  const api = useApi();
  const queries = useQueryClient();
  const handoff = useConversationHandoff();
  const [state, setState] = useState<CoachConversationState>(
    () =>
      (conversationId !== null ? handoff.taken(conversationId) : null) ?? {
        restoring: conversationId !== null || subject !== undefined,
        conversation: null,
        context: null,
        aiDisclosure: true,
        messages: [],
        status: { kind: "idle" },
        repliesOnPage: [],
      },
  );
  const stopper = useRef<AbortController | null>(null);
  // Counts the page's fresh starts: a reply to a conversation since cleared is dropped.
  const generation = useRef(0);
  const latest = useRef(state);
  latest.current = state;
  const callbacks = useRef({ onSaved, announce });
  callbacks.current = { onSaved, announce };
  const subjectKind = subject?.kind;
  const subjectId = subject?.id;

  // The page handed over by the new conversation's first message is open: a later visit reads the conversation again.
  useEffect(() => {
    if (conversationId !== null) handoff.done(conversationId);
  }, [handoff, conversationId]);

  // A saved conversation comes back, unless the page shows it already (its first message handed it over); gone meanwhile,
  // or never started (a Subject's before its first message), the page is a new one.
  useEffect(() => {
    if (conversationId === null && subjectKind === undefined) return;
    if (conversationId !== null && latest.current.conversation?.id === conversationId) return;
    let shown = true;
    const path =
      conversationId !== null
        ? `/api/coach/conversations/${encodeURIComponent(conversationId)}`
        : `/api/coach/conversations?kind=${encodeURIComponent(subjectKind!)}&id=${encodeURIComponent(subjectId!)}`;
    void api
      .read(path, coachConversationResponseSchema)
      .then(({ conversation }) => {
        if (!shown || !conversation) return;
        const { messages, aiDisclosure, context, ...summary } = conversation;
        setState((current) => ({
          ...current,
          conversation: summary,
          context,
          aiDisclosure,
          messages: messages.map((message) => ({ ...message, provenance: message.provenance ?? null })) as ShownMessage[],
        }));
      })
      .catch(() => {})
      .finally(() => shown && setState((current) => ({ ...current, restoring: false })));
    return () => {
      shown = false;
    };
  }, [api, conversationId, subjectKind, subjectId]);

  useEffect(() => () => stopper.current?.abort(), []);

  const update = (change: Partial<CoachConversationState>) => setState((current) => ({ ...current, ...change }));
  /** The page as `change` leaves it, at once: what a new conversation's page is handed is the page with its outcome. */
  const settle = (change: (was: CoachConversationState) => CoachConversationState) => {
    const next = change(latest.current);
    latest.current = next;
    setState(next);
    return next;
  };

  const send = useCallback(
    /** Sends `text`; resolves whether the conversation kept it (a reply, or a Stop), false when it comes back to the box. */
    async (text: string, helpArticle?: { id: string; title: string }): Promise<boolean> => {
      const before = latest.current;
      if (!text || before.status.kind === "sending" || before.restoring) return false;
      const current = before.conversation;
      const shown: ShownMessage[] = [...before.messages, { from: "candidate", text }];
      update({ messages: shown, status: { kind: "sending", live: { step: null, tokens: 0 } } });
      const stop = new AbortController();
      stopper.current = stop;
      const startedIn = generation.current;
      const outcome = await askCoach(
        api,
        {
          // A menu's page: its Subject's conversation, started by this message if it has none; an object's, before its first message.
          ...(subject?.kind === "menu" ? { subject } : current ? { conversationId: current.id } : subject ? { subject } : {}),
          message: text,
          ...(helpArticle ? { helpArticle } : {}),
          route,
        },
        { signal: stop.signal, onLive: (live) => generation.current === startedIn && update({ status: { kind: "sending", live } }) },
      );
      if (stopper.current === stop) stopper.current = null;
      if (generation.current !== startedIn) return true;
      const saved = (conversation: ConversationSummary | null, page: CoachConversationState) => {
        if (!conversation) return;
        if (!subject && current?.id !== conversation.id) {
          if (callbacks.current.onSaved) {
            handoff.keep(conversation.id, page);
            callbacks.current.onSaved(conversation);
          }
          void queries.invalidateQueries({ queryKey: readKey("coachConversations") });
        }
      };

      if (outcome.kind === "reply") {
        const { reply } = outcome;
        const blocked = reply.blocked;
        const cards = reply.cards ?? [];
        const answer: ShownMessage = {
          from: "coach",
          text: reply.reply,
          ...(blocked?.reply ? { blocked: true as const } : {}),
          ...(reply.jobOffer ? { jobOffer: reply.jobOffer } : {}),
          ...(typeof reply.at === "string" ? { provenance: reply.provenance ?? null, at: reply.at } : {}),
          ...(reply.couldNotAnswer === true && !blocked?.reply ? { couldNotAnswer: true as const } : {}),
          ...(cards.length > 0 ? { cards } : {}),
        };
        const page = settle((was) => ({
          ...was,
          conversation: reply.conversation,
          context: reply.context ?? was.context,
          messages: [...before.messages, { from: "candidate", text, ...(blocked?.message ? { blocked: true as const } : {}) }, answer],
          status: { kind: "idle" },
          repliesOnPage: typeof reply.at === "string" ? [...was.repliesOnPage, { provenance: reply.provenance ?? null, at: reply.at }] : was.repliesOnPage,
        }));
        saved(reply.conversation, page);
        callbacks.current.announce({ kind: "reply", text: reply.reply });
        return true;
      } else if (outcome.kind === "stopped") {
        const page = settle((was) => ({
          ...was,
          conversation: outcome.conversation ?? was.conversation,
          context: outcome.context ?? was.context,
          messages: [...shown, { from: "stopped", tokens: outcome.spent.tokens, ms: outcome.spent.ms }],
          status: { kind: "idle" },
        }));
        saved(outcome.conversation, page);
        callbacks.current.announce({ kind: "stopped" });
        return true;
      } else if (outcome.kind === "gone") {
        // Deleted meanwhile (on the web, or past its 12 months): the message starts a new one.
        const status: ReplyStatus = { kind: "failed", reason: null, question: text };
        update({ conversation: null, context: null, aiDisclosure: true, messages: [], status });
        callbacks.current.announce({ kind: "failed", status });
        return false;
      } else {
        // The message comes back to the box, to send again or shorten.
        const status: ReplyStatus =
          outcome.kind === "invalid" ? { kind: "invalid", question: text } : { kind: "failed", reason: isFailureReason(outcome.reason) ? outcome.reason : null, question: text };
        update({ messages: before.messages, status });
        callbacks.current.announce({ kind: "failed", status });
        return false;
      }
    },
    [api, queries, route, subject, handoff],
  );

  /** « Arrêter »: the request is aborted, which is the Stop. */
  const stop = useCallback(() => stopper.current?.abort(), []);

  /**
   * « Effacer » (ADR-0070): deletes every message of the conversation, then the page starts afresh; false when it could
   * not. Never while a reply is on its way: the server keeps the question when the request ends, even stopped.
   */
  const clear = useCallback(async (): Promise<boolean> => {
    const { conversation, status } = latest.current;
    if (status.kind === "sending") return false;
    if (conversation) {
      const response = await api.fetch(`/api/coach/conversations/${encodeURIComponent(conversation.id)}`, { method: "DELETE" }).catch(() => null);
      if (!response?.ok && response?.status !== 404) return false;
      void queries.invalidateQueries({ queryKey: readKey("coachConversations") });
    }
    generation.current += 1;
    update({ conversation: null, context: null, aiDisclosure: true, messages: [], status: { kind: "idle" }, repliesOnPage: [] });
    return true;
  }, [api, queries]);

  /** The Candidate's « Oui » or « Non » under the reply at `index`. */
  const answerFeedback = useCallback((index: number, satisfied: boolean) => {
    setState((was) => ({ ...was, messages: was.messages.map((message, at) => (at === index && message.from === "coach" ? { ...message, satisfied } : message)) }));
  }, []);

  /** A card under the reply at `index`, as the server has it once decided. */
  const cardChanged = useCallback((index: number, changed: CoachProposalCard) => {
    setState((was) => ({
      ...was,
      messages: was.messages.map((message, at) =>
        at === index && message.from === "coach" && message.cards ? { ...message, cards: message.cards.map((card) => (card.id === changed.id ? changed : card)) } : message,
      ),
    }));
  }, []);

  return { ...state, send, stop, clear, answerFeedback, cardChanged };
}
