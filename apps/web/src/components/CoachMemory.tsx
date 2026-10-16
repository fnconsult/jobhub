"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { COACH_MEMORY_KINDS, MAX_ITEM_LENGTH, type CoachMemoryKind, type ProposedMemoryItem } from "@/coach-memory/kinds";

/** An item of the Candidate's Coach Memory as the Coach Panel shows it (dates arrive as JSON strings). */
interface MemoryItem extends ProposedMemoryItem {
  id: string;
  updatedAt: string;
}

type Notice = { kind: "status"; text: string } | { kind: "alert"; text: string } | null;

function Notices({ notice }: { notice: Notice }) {
  return (
    <>
      <div role="status">{notice?.kind === "status" ? <p className="notice">{notice.text}</p> : null}</div>
      {notice?.kind === "alert" ? (
        <p className="notice" role="alert">
          {notice.text}
        </p>
      ) : null}
    </>
  );
}

/** Saves one item the Candidate confirmed or edited; the error key to show otherwise. */
async function save(item: ProposedMemoryItem, itemId?: string): Promise<{ item: MemoryItem } | { error: "invalid" | "full" | "action" }> {
  const response = await fetch(itemId ? `/api/coach/memory/${encodeURIComponent(itemId)}` : "/api/coach/memory", {
    method: itemId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  }).catch(() => null);
  if (response?.ok) return response.json();
  return { error: response?.status === 400 ? "invalid" : response?.status === 409 ? "full" : "action" };
}

/**
 * The Candidate's Coach Memory inside the Coach Panel: every item the AI Coach
 * keeps across conversations, to edit (kind and words) or delete after
 * confirming. Text buttons only (ADR-0009); focus stays on the item acted on.
 */
export function CoachMemoryView() {
  const { t } = useTranslation();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  /** The control to focus once the list has re-rendered (an element id, or the heading). */
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    heading.current?.focus();
    let cancelled = false;
    void fetch("/api/coach/memory")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { items: MemoryItem[] }) => !cancelled && setItems(body.items))
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!focusNext.current) return;
    (focusNext.current === "heading" ? heading.current : document.getElementById(focusNext.current))?.focus();
    focusNext.current = null;
  });

  const editButton = (itemId: string) => `${id}-edit-${itemId}`;
  const deleteButton = (itemId: string) => `${id}-delete-${itemId}`;

  async function edit(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await save({ kind: String(form.get("kind")) as CoachMemoryKind, text: String(form.get("text") ?? "") }, itemId);
    if ("item" in result) {
      setItems((list) => list?.map((item) => (item.id === itemId ? result.item : item)) ?? null);
      setEditing(null);
      setNotice({ kind: "status", text: t("coachMemory.edited") });
      focusNext.current = editButton(itemId);
    } else {
      setNotice({ kind: "alert", text: t(`coachMemory.errors.${result.error === "invalid" ? "invalid" : "action"}`) });
    }
  }

  async function remove(itemId: string) {
    const response = await fetch(`/api/coach/memory/${encodeURIComponent(itemId)}`, { method: "DELETE" }).catch(() => null);
    // Already gone (deleted from another tab): it is off the list either way.
    if (response?.ok || response?.status === 404) {
      setItems((list) => list?.filter((item) => item.id !== itemId) ?? null);
      setConfirming(null);
      setNotice({ kind: "status", text: t("coachMemory.deleted") });
      focusNext.current = "heading";
    } else {
      setNotice({ kind: "alert", text: t("coachMemory.errors.action") });
    }
  }

  return (
    <section className="stack coach-memory" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} ref={heading} tabIndex={-1}>
        {t("coachMemory.title")}
      </h3>
      <p className="hint">{t("coachMemory.hint")}</p>
      <Notices notice={notice} />
      {loadFailed ? (
        <p className="notice" role="alert">
          {t("coachMemory.errors.load")}
        </p>
      ) : items === null ? (
        <p role="status">{t("coachMemory.loading")}</p>
      ) : items.length === 0 ? (
        <p>{t("coachMemory.empty")}</p>
      ) : (
        <ul className="coach-memory-list">
          {items.map((item) => (
            <li key={item.id}>
              <article className="coach-memory-item" aria-labelledby={`${id}-item-${item.id}`}>
                {editing === item.id ? (
                  <form className="stack" onSubmit={(event) => edit(event, item.id)}>
                    <label htmlFor={`${id}-kind-${item.id}`}>{t("coachMemory.kindLabel")}</label>
                    <select id={`${id}-kind-${item.id}`} name="kind" className="input" defaultValue={item.kind}>
                      {COACH_MEMORY_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`coachMemory.kinds.${kind}`)}
                        </option>
                      ))}
                    </select>
                    <label htmlFor={`${id}-text-${item.id}`}>{t("coachMemory.textLabel")}</label>
                    <textarea
                      id={`${id}-text-${item.id}`}
                      name="text"
                      className="input"
                      rows={3}
                      defaultValue={item.text}
                      maxLength={MAX_ITEM_LENGTH}
                      required
                      autoFocus
                      onKeyDown={(event) => {
                        // Escape cancels the edit, not the whole Coach Panel.
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        setEditing(null);
                        focusNext.current = editButton(item.id);
                      }}
                    />
                    <div className="actions">
                      <button className="button button-primary" type="submit">
                        {t("coachMemory.save")}
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          focusNext.current = editButton(item.id);
                        }}
                      >
                        {t("coachMemory.cancel")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p id={`${id}-item-${item.id}`}>
                      <span className="coach-memory-kind">{t(`coachMemory.kinds.${item.kind}`)}</span> {item.text}
                    </p>
                    {confirming === item.id ? (
                      <div className="stack" role="group" aria-labelledby={`${id}-confirm-${item.id}`}>
                        <p id={`${id}-confirm-${item.id}`}>{t("coachMemory.confirmDelete", { text: item.text })}</p>
                        <div className="actions">
                          <button className="button button-danger" type="button" onClick={() => remove(item.id)}>
                            {t("coachMemory.confirmDeleteButton")}
                          </button>
                          <button
                            className="button"
                            type="button"
                            autoFocus
                            onClick={() => {
                              setConfirming(null);
                              focusNext.current = deleteButton(item.id);
                            }}
                          >
                            {t("coachMemory.cancel")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="actions">
                        <button
                          id={editButton(item.id)}
                          className="button"
                          type="button"
                          onClick={() => {
                            setNotice(null);
                            setConfirming(null);
                            setEditing(item.id);
                          }}
                        >
                          {t("coachMemory.edit")}
                        </button>
                        <button
                          id={deleteButton(item.id)}
                          className="button"
                          type="button"
                          onClick={() => {
                            setNotice(null);
                            setEditing(null);
                            setConfirming(item.id);
                          }}
                        >
                          {t("coachMemory.delete")}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Under a Coach Conversation: asks the AI Coach what to remember from it, then
 * lets the Candidate confirm or ignore each proposal. Only confirmed proposals
 * reach the Coach Memory; ignoring one saves nothing.
 */
export function CoachMemoryProposals({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const [proposals, setProposals] = useState<ProposedMemoryItem[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (proposals) heading.current?.focus();
  }, [proposals]);

  async function ask() {
    setAsking(true);
    setNotice(null);
    setProposals(null);
    const response = await fetch("/api/coach/memory/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId }),
    }).catch(() => null);
    setAsking(false);
    if (!response?.ok) return setNotice({ kind: "alert", text: t(response?.status === 503 ? "coachMemory.errors.unavailable" : "coachMemory.errors.action") });
    const body: { proposals: ProposedMemoryItem[] } = await response.json();
    if (body.proposals.length === 0) setNotice({ kind: "status", text: t("coachMemory.noProposals") });
    setProposals(body.proposals);
  }

  async function confirm(proposal: ProposedMemoryItem) {
    const result = await save(proposal);
    if ("item" in result) {
      setProposals((list) => list?.filter((item) => item !== proposal) ?? null);
      setNotice({ kind: "status", text: t("coachMemory.confirmed", { text: result.item.text }) });
    } else {
      setNotice({ kind: "alert", text: t(`coachMemory.errors.${result.error}`) });
    }
  }

  function dismiss(proposal: ProposedMemoryItem) {
    setProposals((list) => list?.filter((item) => item !== proposal) ?? null);
    setNotice({ kind: "status", text: t("coachMemory.dismissed") });
  }

  return (
    <section className="stack coach-memory-proposals" aria-labelledby={proposals?.length ? `${id}-heading` : undefined}>
      <button className="button" type="button" onClick={ask} disabled={asking}>
        {t("coachMemory.propose")}
      </button>
      {asking ? <p role="status">{t("coachMemory.proposing")}</p> : null}
      <Notices notice={notice} />
      {proposals?.length ? (
        <>
          <h4 id={`${id}-heading`} ref={heading} tabIndex={-1}>
            {t("coachMemory.proposalsTitle")}
          </h4>
          <p className="hint">{t("coachMemory.proposalsHint")}</p>
          <ul className="coach-memory-list">
            {proposals.map((proposal, index) => (
              <li key={`${proposal.kind}:${proposal.text}`}>
                <article className="coach-memory-item" aria-labelledby={`${id}-proposal-${index}`}>
                  <p id={`${id}-proposal-${index}`}>
                    <span className="coach-memory-kind">{t(`coachMemory.kinds.${proposal.kind}`)}</span> {proposal.text}
                  </p>
                  <div className="actions">
                    <button className="button button-primary" type="button" onClick={() => confirm(proposal)}>
                      {t("coachMemory.confirm")}
                    </button>
                    <button className="button" type="button" onClick={() => dismiss(proposal)}>
                      {t("coachMemory.dismiss")}
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
