"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { helpLocale, onThisPage } from "@/coach-help";
import type { ConversationContext } from "@/coach/conversation";
import { Icons } from "@/components/icons";
import { CURRENT, type CloseDrawerThen } from "@/components/SidebarShell";
import { useWorkPane } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { ConfirmDialog } from "@/design/Dialog";
import { routes } from "@/routes";
import type { UnfoldedMenu } from "@/sidebar-menus";

/** A Free conversation as the Sidebar lists it (ADR-0070): a Coach Conversation with no Subject. */
export type FreeConversation = { id: string; title: string };

/** The Sidebar's menus with objects, by their Sidebar key, and what each unfolds into: Mes candidatures (#604), Recherches d'offres and Job Digests (#606). */
export type SidebarMenus = Partial<Record<SidebarMenuKey, UnfoldedMenu>>;

/** The Sidebar menus that unfold into their objects (ADR-0070). */
export const SIDEBAR_MENUS_WITH_OBJECTS = ["applications", "jobSearches", "jobDigests"] as const;
export type SidebarMenuKey = (typeof SIDEBAR_MENUS_WITH_OBJECTS)[number];

/** Whether the Sidebar's link `key` is a menu with objects. */
export const hasObjects = (key: string): key is SidebarMenuKey => (SIDEBAR_MENUS_WITH_OBJECTS as readonly string[]).includes(key);

/**
 * The conversation a page shows as itself (ADR-0070: the home page's, for now), while it is shown: `conversationId`
 * once its first message saved it; `replying` while a reply is on its way, when it cannot be cleared; `clear` deletes every
 * message of it (« Effacer ») and resolves whether it did; `startNew` turns the page into a new Free conversation, as the
 * home page is, null on a menu's page (#604) or an object's (#603), which « Nouvelle conversation » leaves for the home page; `askAbout` starts,
 * in its box, a question about a Help Article, whose title goes with it (« Demander au coach » in the Work Pane, #602);
 * `context`, its Context bar's figures as the server last said them (#607), null until it is saved.
 */
export type PageConversation = {
  conversationId: string | null;
  replying: boolean;
  context: ConversationContext | null;
  clear: () => Promise<boolean>;
  startNew: (() => void) | null;
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
  /** What the Sidebar's menus with objects unfold into. */
  menus: SidebarMenus;
}

const Context = createContext<ConversationFirst | null>(null);

/**
 * What the Candidate's pages share under « Conversation au centre » (#601, ADR-0070): the Sidebar's Free conversations,
 * kept up to date as the page's conversation is saved, renamed or cleared, and the page's conversation, which « Effacer »
 * in the Top Bar and « Nouvelle conversation » in the Sidebar act on. Its absence means the switch is off.
 */
export function ConversationFirstProvider({
  conversations: initial,
  menus = NO_MENUS,
  children,
}: {
  conversations: readonly FreeConversation[];
  menus?: SidebarMenus;
  children: ReactNode;
}) {
  const [conversations, setConversations] = useState<readonly FreeConversation[]>(initial);
  const [page, setPageState] = useState<PageConversation | null>(null);
  const saved = useCallback((conversation: FreeConversation) => {
    setConversations((list) =>
      list.some((each) => each.id === conversation.id) ? list.map((each) => (each.id === conversation.id ? { id: each.id, title: conversation.title } : each)) : [{ id: conversation.id, title: conversation.title }, ...list],
    );
  }, []);
  const removed = useCallback((conversationId: string) => setConversations((list) => list.filter((each) => each.id !== conversationId)), []);
  const setPage = useCallback((next: PageConversation | null) => setPageState(next), []);
  const value = useMemo(() => ({ conversations, saved, removed, page, setPage, menus }), [conversations, saved, removed, page, setPage, menus]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const NO_MENUS: SidebarMenus = {};

/** The pages' conversations under « Conversation au centre »; null while it is off. */
export function useConversationFirst(): ConversationFirst | null {
  return useContext(Context);
}

/**
 * The Sidebar's conversations (ADR-0070): « Nouvelle conversation », which leads to the home page, a new Free
 * conversation; then « Coach », which folds, with the Free conversations, each its own page, renamed or deleted from its
 * actions (deleting asks first), and « Mémoire du coach », opened in the Work Pane (#602). `onNavigate`: closes the
 * Sidebar's drawer on phones; `closeDrawerThen` opens the Work Pane once it has (SidebarShell). Nothing while the switch is off.
 */
export function SidebarConversations({ onNavigate, closeDrawerThen }: { onNavigate?: () => void; closeDrawerThen?: CloseDrawerThen }) {
  const { t } = useTranslation();
  const conversationFirst = useConversationFirst();
  const pathname = usePathname();
  const id = useId();
  const [open, setOpen] = useUnfolded(COACH_MENU);
  const workPane = useWorkPane();
  if (!conversationFirst) return null;
  const { conversations, page } = conversationFirst;
  return (
    <div className="sidebar-conversations">
      <Link
        className="sidebar-link sidebar-new-conversation"
        href={routes.home}
        onClick={(event) => {
          // The page already shows a Free conversation: it starts afresh in place, as a reload of the home page would.
          // An object's page, and a menu's, lead to the home page.
          if (page?.startNew) {
            event.preventDefault();
            page.startNew();
          }
          onNavigate?.();
        }}
      >
        <Icons.newConversation />
        {t("conversationFirst.newConversation")}
      </Link>
      <button className="sidebar-link sidebar-fold" type="button" aria-expanded={open} aria-controls={`${id}-coach`} onClick={() => setOpen(!open)}>
        <Icons.coach />
        <span id={`${id}-coach-label`}>{t("conversationFirst.coach")}</span>
        <Icons.chevron />
      </button>
      {open ? (
        <ul id={`${id}-coach`} className="sidebar-sublist" aria-labelledby={`${id}-coach-label`}>
          {conversations.map((conversation) => (
            <FreeConversationItem key={conversation.id} conversation={conversation} current={pathname === routes.conversation(conversation.id)} onNavigate={onNavigate} />
          ))}
          {workPane ? (
            <li>
              <button
                className="sidebar-link sidebar-memory"
                type="button"
                onClick={() => {
                  // From the drawer on a phone, once it has closed: the page, the Work Pane with it, is inert behind it.
                  const show = () => workPane.open({ kind: "memory" });
                  if (closeDrawerThen) closeDrawerThen(show);
                  else show();
                }}
              >
                <Icons.memory />
                {t("coachMemory.open")}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** « Coach » among the menus whose fold this browser remembers. */
const COACH_MENU = "coach";
/** The menus this browser keeps folded, a JSON list of their keys (a per-browser convenience, like the hidden Sidebar). */
const FOLDED_STORAGE_KEY = "jobbbox.sidebarFolded";
const foldListeners = new Set<() => void>();
/** The folded menus while this browser's storage is out of reach (`unsaved`): they hold until the page is left. */
let foldedInMemory: string | null = null;
let unsaved = false;

function readFolded(): string | null {
  if (unsaved) return foldedInMemory;
  try {
    return window.localStorage.getItem(FOLDED_STORAGE_KEY);
  } catch {
    return foldedInMemory;
  }
}

function writeFolded(value: string) {
  foldedInMemory = value;
  try {
    window.localStorage.setItem(FOLDED_STORAGE_KEY, value);
    unsaved = false;
  } catch {
    unsaved = true;
  }
  for (const listener of foldListeners) listener();
}

function foldedMenus(stored: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function subscribeToFolds(listener: () => void) {
  foldListeners.add(listener);
  // Folded in another tab of this browser: this one follows.
  window.addEventListener("storage", listener);
  return () => {
    foldListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Whether the Sidebar's `menu` is unfolded, and the way to fold or unfold it (#604): remembered in this browser, unfolded
 * until folded, the same in the docked Sidebar and its drawer. The server, which cannot know, draws it unfolded; with
 * storage blocked, the choice holds until the page is left.
 */
function useUnfolded(menu: string): [boolean, (open: boolean) => void] {
  const stored = useSyncExternalStore(subscribeToFolds, readFolded, () => null);
  const open = !foldedMenus(stored).includes(menu);
  const setOpen = useCallback(
    (next: boolean) => {
      const others = foldedMenus(readFolded()).filter((key) => key !== menu);
      writeFolded(JSON.stringify(next ? others : [...others, menu]));
    },
    [menu],
  );
  return [open, setOpen];
}

/**
 * One of the Sidebar's menus (#604): its link, to its page; with objects (Mes candidatures, Recherches d'offres and Job
 * Digests (#606), under « Conversation au centre »), the button that unfolds it into them, each to its page, the one open highlighted rather than the menu, those
 * à traiter marked with a dot, then « Tout voir (N) ». Its fold is remembered in this browser. `current`: the page shown is
 * the menu's or one under it. `onNavigate`: closes the Sidebar's drawer on phones.
 */
export function SidebarMenu({
  menu,
  href,
  current,
  icon,
  label,
  onNavigate,
}: {
  menu: keyof SidebarMenus;
  href: string;
  current: boolean;
  icon: ReactNode;
  label: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const id = useId();
  const objects = useConversationFirst()?.menus[menu];
  const [open, setOpen] = useUnfolded(menu);
  const unfolds = objects !== undefined && objects.total > 0;
  // The object open, listed under the menu: it is the one highlighted.
  const objectShown = unfolds && open && objects.shown.some((object) => object.href === pathname);
  const link = (
    <Link className="sidebar-link" href={href} aria-current={current && !objectShown ? CURRENT : undefined} onClick={onNavigate}>
      {icon}
      <span className="sidebar-link-text">{label}</span>
    </Link>
  );
  if (!unfolds) return <li>{link}</li>;
  return (
    <li>
      <div className="sidebar-menu-row">
        {link}
        <button
          className={`${buttonClass({ variant: "quiet", size: "sm" })} sidebar-menu-fold`}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-objects`}
          aria-label={t("conversationFirst.unfold", { menu: label })}
          onClick={() => setOpen(!open)}
        >
          <Icons.chevron />
        </button>
      </div>
      {open ? (
        <ul id={`${id}-objects`} className="sidebar-sublist" aria-label={label}>
          {objects.shown.map((object) => (
            <li key={object.id}>
              <Link className="sidebar-link" href={object.href} aria-current={object.href === pathname ? CURRENT : undefined} onClick={onNavigate}>
                <span className="sidebar-link-text">{object.label}</span>
                {object.toHandle ? (
                  <span className="sidebar-dot" title={t("conversationFirst.toHandle")}>
                    <span className="visually-hidden">, {t("conversationFirst.toHandle")}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
          <li>
            <Link className="sidebar-link sidebar-see-all" href={href} onClick={onNavigate}>
              {t("conversationFirst.seeAll", { count: objects.total })}
            </Link>
          </li>
        </ul>
      ) : null}
    </li>
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
    if (conversationFirst.page?.conversationId === conversation.id) conversationFirst.page.startNew?.();
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
 * `inContextBar`: the same, offered by the Context bar once it is nearly full (#607), « Effacer la conversation ».
 */
export function ClearConversationButton({ inContextBar = false }: { inContextBar?: boolean }) {
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
        inContextBar ? (
          <button className={`${buttonClass({ variant: "quiet", size: "sm" })} context-bar-clear`} type="button" disabled={page.replying}>
            {t("contextBar.clear")}
          </button>
        ) : (
          <button className={`${buttonClass()} topbar-clear`} type="button" disabled={page.replying}>
            <Icons.clear />
            {t("conversationFirst.clear")}
          </button>
        )
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

/**
 * « Aide » in the Top Bar of a page without a conversation (Mon compte, #602, ADR-0070): opens the page's Help Article in
 * the Work Pane, whose « Demander au coach » starts a Free conversation about it. Nothing on a page that is a
 * conversation (its box suggests the help), on a page without an article, or while the switch is off.
 */
export function PageHelpButton() {
  const { t, i18n } = useTranslation();
  const conversationFirst = useConversationFirst();
  const workPane = useWorkPane();
  const pathname = usePathname();
  const article = onThisPage(pathname, helpLocale(i18n.language))?.article;
  // A conversation's page is known by its address too, before it registers itself: the button never flashes there.
  const isConversation = conversationFirst?.page || pathname === routes.home || pathname.startsWith(routes.conversation(""));
  if (!conversationFirst || isConversation || !workPane || !article) return null;
  return (
    <button className={`${buttonClass()} topbar-help`} type="button" onClick={() => workPane.open({ kind: "help", article })}>
      <Icons.help />
      {t("conversationFirst.help")}
    </button>
  );
}
