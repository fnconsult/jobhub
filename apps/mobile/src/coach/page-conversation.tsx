import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ConversationContext, Live } from "./coach-reply";
import type { ReplyOnPage } from "./use-coach-conversation";

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

const Registry = createContext<{ page: PageConversation | null; setPage: (page: PageConversation | null) => void }>({ page: null, setPage: () => {} });

export function PageConversationProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<PageConversation | null>(null);
  const value = useMemo(() => ({ page, setPage }), [page]);
  return <Registry.Provider value={value}>{children}</Registry.Provider>;
}

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
