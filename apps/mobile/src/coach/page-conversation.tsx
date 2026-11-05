import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ConversationContext, Live } from "./coach-reply";
import type { CoachConversationState, ReplyOnPage } from "./use-coach-conversation";

/**
 * The page's Coach Conversation as the rest of the shell reads it (the web's `conversationFirst.page`): the Top Bar's
 * « Effacer », and Activité's Context bar and AI Activity, which sit outside the conversation's own screen.
 */
export type PageConversation = {
  /** The saved conversation shown; null before its first message. */
  conversationId: string | null;
  /** The reply on its way, live; null when none is. */
  live: Live | null;
  context: ConversationContext | null;
  repliesOnPage: readonly ReplyOnPage[];
  /** « Effacer »: every message deleted, the page afresh; false when it could not be. */
  clear: () => Promise<boolean>;
  /** Stops the reply on its way (AI Activity's stop). */
  stop: () => void;
};

/**
 * A new Free conversation's page, handed to the page its first message gives it the address of (ADR-0070): the web only
 * rewrites its address, the app opens the conversation's page, a new screen. What the server never stores (« Réponse
 * arrêtée », the reply the coach could not answer, the replies given on the page) goes with it: `keep` before the page
 * changes, `taken` by the conversation's page as it opens.
 */
export type Handoff = {
  keep: (conversationId: string, state: CoachConversationState) => void;
  taken: (conversationId: string) => CoachConversationState | null;
  /** The handed page is open: a later visit reads the conversation again. */
  done: (conversationId: string) => void;
};

const NO_HANDOFF: Handoff = { keep: () => {}, taken: () => null, done: () => {} };

const Registry = createContext<{ page: PageConversation | null; setPage: (page: PageConversation | null) => void; handoff: Handoff }>({
  page: null,
  setPage: () => {},
  handoff: NO_HANDOFF,
});

export function PageConversationProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageConversation | null>(null);
  const kept = useRef<{ conversationId: string; state: CoachConversationState } | null>(null);
  const handoff = useMemo<Handoff>(
    () => ({
      keep: (conversationId, state) => void (kept.current = { conversationId, state }),
      taken: (conversationId) => (kept.current?.conversationId === conversationId ? kept.current.state : null),
      done: (conversationId) => {
        if (kept.current?.conversationId === conversationId) kept.current = null;
      },
    }),
    [],
  );
  const value = useMemo(() => ({ page, setPage, handoff }), [page, handoff]);
  return <Registry.Provider value={value}>{children}</Registry.Provider>;
}

/** The handoff of a new Free conversation's page to its conversation's page. */
export const useConversationHandoff = () => useContext(Registry).handoff;

/** The page's conversation, if the page is one. */
export const usePageConversation = () => useContext(Registry).page;

/** Makes `page` the page's conversation while it is shown. */
export function useRegisterPageConversation(page: PageConversation) {
  const { setPage } = useContext(Registry);
  const { conversationId, live, context, repliesOnPage, clear, stop } = page;
  useEffect(() => {
    setPage({ conversationId, live, context, repliesOnPage, clear, stop });
  }, [setPage, conversationId, live, context, repliesOnPage, clear, stop]);
  useEffect(() => () => setPage(null), [setPage]);
}
