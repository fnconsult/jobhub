"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";

/** A saved Coach Conversation as the Coach Panel lists it (dates arrive as JSON strings). The Back Office Assistant's have no Profile. */
export interface ConversationSummary {
  id: string;
  title: string;
  profile?: { id: string; name: string } | null;
  lastMessageAt: string;
}

type Notice = { kind: "status"; text: string } | { kind: "alert"; text: string } | null;

/**
 * The Candidate's Coach Conversations inside the Coach Panel (or an Administrator's
 * Back Office Assistant conversations), most recently active first: open one, rename
 * it, or delete it after confirming. Text buttons only (ADR-0009); focus stays on the
 * conversation being acted on. `endpoint`: where each conversation is, by id.
 */
export function CoachConversationList({
  endpoint = "/api/coach/conversations",
  texts = { retention: "coachPanel.retention", noConversations: "coachPanel.noConversations" },
  conversations,
  loadFailed,
  onOpen,
  onRenamed,
  onDeleted,
}: {
  endpoint?: string;
  /** The i18n keys of what differs between the Coach Panel and the Back Office Assistant. */
  texts?: { retention: ParseKeys; noConversations: ParseKeys };
  conversations: ConversationSummary[] | null;
  loadFailed: boolean;
  /** Resolves false when the conversation could not be opened. */
  onOpen: (id: string) => Promise<boolean>;
  onRenamed: (conversation: ConversationSummary) => void;
  onDeleted: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  /** The control to focus once the list has re-rendered (an element id, or the heading). */
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (!focusNext.current) return;
    (focusNext.current === "heading" ? heading.current : document.getElementById(focusNext.current))?.focus();
    focusNext.current = null;
  });

  const setFocusNext = (target: string) => {
    focusNext.current = target;
  };

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short" });
  const renameButton = (conversationId: string) => `${id}-rename-${conversationId}`;
  const deleteButton = (conversationId: string) => `${id}-delete-${conversationId}`;

  async function open(conversationId: string) {
    setNotice(null);
    if (!(await onOpen(conversationId))) setNotice({ kind: "alert", text: t("coachPanel.listErrors.action") });
  }

  async function rename(event: FormEvent<HTMLFormElement>, conversationId: string) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "");
    const response = await fetch(`${endpoint}/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => null);
    if (response?.ok) {
      const { conversation } = await response.json();
      onRenamed(conversation);
      setRenaming(null);
      setNotice({ kind: "status", text: t("coachPanel.renamed") });
      setFocusNext(renameButton(conversationId));
    } else {
      setNotice({ kind: "alert", text: t(response?.status === 400 ? "coachPanel.listErrors.invalidTitle" : "coachPanel.listErrors.action") });
    }
  }

  async function remove(conversationId: string) {
    const response = await fetch(`${endpoint}/${encodeURIComponent(conversationId)}`, { method: "DELETE" }).catch(() => null);
    // Already gone (deleted from another tab, or purged): it is off the list either way.
    if (response?.ok || response?.status === 404) {
      onDeleted(conversationId);
      setConfirming(null);
      setNotice({ kind: "status", text: t("coachPanel.deleted") });
      setFocusNext("heading");
    } else {
      setNotice({ kind: "alert", text: t("coachPanel.listErrors.action") });
    }
  }

  return (
    <section className="stack coach-conversations" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} ref={heading} tabIndex={-1}>
        {t("coachPanel.conversations")}
      </h3>
      <p className="hint">{t(texts.retention)}</p>
      <div role="status">{notice?.kind === "status" ? <p className="notice">{notice.text}</p> : null}</div>
      {notice?.kind === "alert" ? (
        <p className="notice" role="alert">
          {notice.text}
        </p>
      ) : null}
      {loadFailed ? (
        <p className="notice" role="alert">
          {t("coachPanel.listErrors.load")}
        </p>
      ) : conversations === null ? (
        <p role="status">{t("coachPanel.loading")}</p>
      ) : conversations.length === 0 ? (
        <p>{t(texts.noConversations)}</p>
      ) : (
        <ul className="coach-conversation-list">
          {conversations.map((conversation) => {
            const titleId = `${id}-title-${conversation.id}`;
            return (
              <li key={conversation.id}>
                <article className="coach-conversation" aria-labelledby={titleId}>
                  <h4 id={titleId} className="coach-conversation-title">
                    <button className="link-button" type="button" onClick={() => open(conversation.id)}>
                      {conversation.title}
                    </button>
                  </h4>
                  {conversation.profile ? <p className="hint">{t("coachPanel.startedOnProfile", { name: conversation.profile.name })}</p> : null}
                  <p className="hint">{t("coachPanel.lastMessage", { date: date.format(new Date(conversation.lastMessageAt)) })}</p>
                  {confirming === conversation.id ? (
                    <div className="stack" role="group" aria-labelledby={`${id}-confirm-${conversation.id}`}>
                      <p id={`${id}-confirm-${conversation.id}`}>{t("coachPanel.confirmDelete", { title: conversation.title })}</p>
                      <div className="actions">
                        <button className="button button-danger" type="button" onClick={() => remove(conversation.id)}>
                          {t("coachPanel.confirmDeleteButton")}
                        </button>
                        <button
                          className="button"
                          type="button"
                          autoFocus
                          onClick={() => {
                            setConfirming(null);
                            setFocusNext(deleteButton(conversation.id));
                          }}
                        >
                          {t("coachPanel.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : renaming === conversation.id ? (
                    <form className="stack" onSubmit={(event) => rename(event, conversation.id)}>
                      <label htmlFor={`${id}-name-${conversation.id}`}>
                        {t("coachPanel.renameLabel")}
                      </label>
                      <input
                        id={`${id}-name-${conversation.id}`}
                        name="title"
                        className="input"
                        defaultValue={conversation.title}
                        maxLength={80}
                        required
                        autoFocus
                        onKeyDown={(event) => {
                          // Escape cancels the renaming, not the whole Coach Panel.
                          if (event.key !== "Escape") return;
                          event.stopPropagation();
                          setRenaming(null);
                          setFocusNext(renameButton(conversation.id));
                        }}
                      />
                      <div className="actions">
                        <button className="button button-primary" type="submit">
                          {t("coachPanel.save")}
                        </button>
                        <button
                          className="button"
                          type="button"
                          onClick={() => {
                            setRenaming(null);
                            setFocusNext(renameButton(conversation.id));
                          }}
                        >
                          {t("coachPanel.cancel")}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="actions">
                      <button
                        id={renameButton(conversation.id)}
                        className="button"
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          setConfirming(null);
                          setRenaming(conversation.id);
                        }}
                      >
                        {t("coachPanel.rename")}
                      </button>
                      <button
                        id={deleteButton(conversation.id)}
                        className="button"
                        type="button"
                        onClick={() => {
                          setNotice(null);
                          setRenaming(null);
                          setConfirming(conversation.id);
                        }}
                      >
                        {t("coachPanel.delete")}
                      </button>
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
