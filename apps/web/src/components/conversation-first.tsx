"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import { CURRENT } from "@/components/SidebarShell";
import { buttonClass } from "@/design/button-class";
import { ConfirmDialog } from "@/design/Dialog";
import { routes } from "@/routes";

/** A Free conversation as the Sidebar lists it (ADR-0070): a Coach Conversation with no Subject. */
export type FreeConversation = { id: string; title: string };

/**
 * The conversation a page shows as itself (ADR-0070: the home page's, for now), while it is shown: `conversationId`
 * once its first message saved it; `replying` while a reply is on its way, when it cannot be cleared; `clear` deletes every
 * message of it (« Effacer ») and resolves whether it did; `startNew` turns the page into a new Free conversation, as the
 * home page is; `askAbout` starts, in its box, a question about a Help Article, whose title goes with it (« Demander au
 * coach » in the Work Pane, #602).
 */
export type PageConversation = {
  conversationId: string | null;
  replying: boolean;
  clear: () => Promise<boolean>;
  startNew: () => void;
  askAbout: (article: { id: string; title: string }) => void;
};

interface ConversationFirst {
  /** The Candidate's Free conversations, most recently active first. */
  conversations: readonly FreeConversation[];
  /** A Free conversation saved or renamed: listed first when new, renamed in place otherwise. */
  saved: (conversation: FreeConversation) => void;
  removed: (conversationId: string) => void;
  page: PageConversation | null;
  /** A page registers its conversation while it shows it, and clears it (null) when it goes. */
  setPage: (page: PageConversation | null) => void;
}

const Context = createContext<ConversationFirst | null>(null);

/**
 * What the Candidate's pages share under « Conversation au centre » (#601, ADR-0070): the Sidebar's Free conversations,
 * kept up to date as the page's conversation is saved, renamed or cleared, and the page's conversation, which « Effacer »
 * in the Top Bar and « Nouvelle conversation » in the Sidebar act on. Its absence means the switch is off.
 */
export function ConversationFirstProvider({ conversations: initial, children }: { conversations: readonly FreeConversation[]; children: ReactNode }) {
  const [conversations, setConversations] = useState<readonly FreeConversation[]>(initial);
  const [page, setPageState] = useState<PageConversation | null>(null);
  const saved = useCallback((conversation: FreeConversation) => {
    setConversations((list) =>
      list.some((each) => each.id === conversation.id) ? list.map((each) => (each.id === conversation.id ? { id: each.id, title: conversation.title } : each)) : [{ id: conversation.id, title: conversation.title }, ...list],
    );
  }, []);
  const removed = useCallback((conversationId: string) => setConversations((list) => list.filter((each) => each.id !== conversationId)), []);
  const setPage = useCallback((next: PageConversation | null) => setPageState(next), []);
  const value = useMemo(() => ({ conversations, saved, removed, page, setPage }), [conversations, saved, removed, page, setPage]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The pages' conversations under « Conversation au centre »; null while it is off. */
export function useConversationFirst(): ConversationFirst | null {
  return useContext(Context);
}

/**
 * The Sidebar's conversations (ADR-0070): « Nouvelle conversation », which leads to the home page, a new Free
 * conversation; then « Coach », which folds, with the Free conversations, each its own page, renamed or deleted from its
 * actions (deleting asks first). `onNavigate`: closes the Sidebar's drawer on phones. Nothing while the switch is off.
 */
export function SidebarConversations({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const conversationFirst = useConversationFirst();
  const pathname = usePathname();
  const id = useId();
  const [open, setOpen] = useState(true);
  if (!conversationFirst) return null;
  const { conversations, page } = conversationFirst;
  return (
    <div className="sidebar-conversations">
      <Link
        className="sidebar-link sidebar-new-conversation"
        href={routes.home}
        onClick={(event) => {
          // The page already shows a conversation: it starts afresh in place, as a reload of the home page would.
          if (page) {
            event.preventDefault();
            page.startNew();
          }
          onNavigate?.();
        }}
      >
        <Icons.newConversation />
        {t("conversationFirst.newConversation")}
      </Link>
      <button className="sidebar-link sidebar-fold" type="button" aria-expanded={open} aria-controls={`${id}-coach`} onClick={() => setOpen((was) => !was)}>
        <Icons.coach />
        <span id={`${id}-coach-label`}>{t("conversationFirst.coach")}</span>
        <Icons.chevron />
      </button>
      {open ? (
        <ul id={`${id}-coach`} className="sidebar-sublist" aria-labelledby={`${id}-coach-label`}>
          {conversations.map((conversation) => (
            <FreeConversationItem key={conversation.id} conversation={conversation} current={pathname === routes.conversation(conversation.id)} onNavigate={onNavigate} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type FetchOutcome = "done" | "invalid" | "failed";

/** A conversation's actions open under their button, from its start. */
const MENU_ALIGN = "start";

/** One Free conversation in the Sidebar: its link, and its actions (« Renommer », « Supprimer »). */
function FreeConversationItem({ conversation, current, onNavigate }: { conversation: FreeConversation; current: boolean; onNavigate: (() => void) | undefined }) {
  const { t } = useTranslation();
  const conversationFirst = useConversationFirst()!;
  const id = useId();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/coach/conversations/${encodeURIComponent(conversation.id)}`;

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "");
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).catch(() => null);
    const outcome: FetchOutcome = response?.ok ? "done" : response?.status === 400 ? "invalid" : "failed";
    if (outcome === "done") {
      const renamed = ((await response!.json()) as { conversation: FreeConversation }).conversation;
      conversationFirst.saved({ id: conversation.id, title: renamed.title });
      setRenaming(false);
      setError(null);
      requestAnimationFrame(() => actions.current?.focus());
    } else setError(t(outcome === "invalid" ? "coachPanel.listErrors.invalidTitle" : "coachPanel.listErrors.action"));
  }

  async function remove() {
    const response = await fetch(endpoint, { method: "DELETE" }).catch(() => null);
    // Already gone (another tab, or purged): it is off the list either way.
    if (!response?.ok && response?.status !== 404) {
      setError(t("coachPanel.listErrors.action"));
      return;
    }
    conversationFirst.removed(conversation.id);
    if (conversationFirst.page?.conversationId === conversation.id) conversationFirst.page.startNew();
  }

  return (
    <li className="sidebar-conversation">
      {renaming ? (
        <form className="sidebar-rename" onSubmit={rename}>
          <label className="visually-hidden" htmlFor={`${id}-title`}>
            {t("conversationFirst.nameLabel")}
          </label>
          <input
            id={`${id}-title`}
            name="title"
            className="input"
            defaultValue={conversation.title}
            maxLength={80}
            required
            autoFocus
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setRenaming(false);
              setError(null);
              requestAnimationFrame(() => actions.current?.focus());
            }}
          />
        </form>
      ) : (
        <div className="sidebar-conversation-row">
          <Link className="sidebar-link" href={routes.conversation(conversation.id)} aria-current={current ? CURRENT : undefined} onClick={onNavigate}>
            <span className="sidebar-link-text">{conversation.title}</span>
          </Link>
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger ref={actions} className={`${buttonClass({ variant: "quiet", size: "sm" })} sidebar-conversation-actions`} aria-label={t("conversationFirst.actions", { title: conversation.title })}>
              <Icons.more />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" align={MENU_ALIGN} sideOffset={4}>
                <DropdownMenu.Item className="menu-item" onSelect={() => setRenaming(true)}>
                  {t("coachPanel.rename")}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => setDeleting(true)}>
                  {t("coachPanel.delete")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
      {error ? (
        <p className="hint" role="alert">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("conversationFirst.deleteTitle", { title: conversation.title })}
        confirmLabel={t("coachPanel.delete")}
        tone="danger"
        onConfirm={() => void remove()}
      >
        {t("conversationFirst.deleteText")}
      </ConfirmDialog>
    </li>
  );
}

/**
 * « Effacer » in the Top Bar (ADR-0070), while a page shows its conversation: after a confirming Dialog (the focus on
 * « Annuler »), deletes every message of the page's conversation; Coach Memory stays. The page starts afresh, and the
 * Sidebar no longer lists it. Unavailable while a reply is on its way: the server saves the Candidate's message when the
 * reply ends or is stopped, which would leave it saved after clearing; « Arrêter » first, then « Effacer ».
 */
export function ClearConversationButton() {
  const { t } = useTranslation();
  const conversationFirst = useConversationFirst();
  const page = conversationFirst?.page;
  if (!conversationFirst || !page) return null;
  async function clear() {
    const conversationId = page!.conversationId;
    if ((await page!.clear()) && conversationId) conversationFirst!.removed(conversationId);
  }
  return (
    <ConfirmDialog
      trigger={
        <button className={`${buttonClass()} topbar-clear`} type="button" disabled={page.replying}>
          <Icons.clear />
          {t("conversationFirst.clear")}
        </button>
      }
      title={t("conversationFirst.clearTitle")}
      confirmLabel={t("conversationFirst.clear")}
      tone="danger"
      onConfirm={() => void clear()}
    >
      {t("conversationFirst.clearText")}
    </ConfirmDialog>
  );
}
