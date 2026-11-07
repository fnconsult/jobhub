"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatTimeOfDay, formatTokens, PROVENANCE_GLYPHS, type Activity, type ProvenanceSite } from "@jobhub/shared";
import type { ActivityEntry, EntryKind, EntryProposal, EntryStep } from "@/ai-activity/entries";
import { costShown, historyByDay, pageSources, type CostShown, type QuotaUse } from "@/ai-activity/history";
import type { ActivityTool, ElementEnd } from "@/ai-activity/pane";
import { messageAnchor } from "@/ai-activity/thread";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { useActivityColumn } from "@/components/activity-column";
import { ConsultedLabel } from "@/components/CoachToolSteps";
import { ExternalLink } from "@/components/ExternalLink";
import { Icons } from "@/components/icons";
import { routes } from "@/routes";

type Language = "fr" | "en";

/** Where the cost of an entry is counted: « Votre consommation » on Mon abonnement (ADR-0091, #801). */
const CONSUMPTION = `${routes.subscription}#consommation`;
/** How long a row or a message reached from a link stays marked. */
const HIGHLIGHT_MS = 1_600;

/** The glyph of each kind of entry, its Activity at rest. */
const GLYPH: Record<EntryKind, Activity> = {
  coach_reply: "think_write",
  job_search: "web_search",
  job_offer: "read",
  job_digest: "compute",
  tailored_cv: "write",
  tailored_documents: "write",
  company_dossier: "search",
  action_card: "act",
  ats_score: "compute",
  master_cv: "read",
  master_cv_version: "write",
  change: "act",
};

/** `t` over keys built from an entry's kind, state or quota: a string, as react-i18next's types cannot follow them. */
type T = (key: string, options?: Record<string, unknown>) => string;
const useT = () => useTranslation().t as unknown as T;

function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === "en" ? "en" : "fr";
}

const timeOf = (at: string, language: Language) => new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));

/** « 27/10 » (« 27 Oct »), with the year when it is not this one's. */
function dayOf(at: string, language: Language): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const format = language === "fr" ? { day: "2-digit", month: "2-digit" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(language === "fr" ? "fr-FR" : "en-GB", { ...format, ...(sameYear ? {} : { year: "numeric" }) } as Intl.DateTimeFormatOptions).format(date);
}

/** Marks `element` for a moment: the row or the message a link led to. */
function highlight(element: Element | null) {
  if (!(element instanceof HTMLElement)) return;
  element.dataset.highlighted = "true";
  setTimeout(() => delete element.dataset.highlighted, HIGHLIGHT_MS);
}

const motion = () => (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/**
 * The history of Activity (CONTEXT.md « Activité entry », ADR-0086, #808), under « En ce moment »: the page's Activité
 * entries, newest first, by day (« Aujourd'hui », « Le 27/10 »). One row each, a button that unfolds its detail: its
 * glyph, title, result, cost in short and time. Its detail: the question, the steps, what it read, its Tools and models,
 * its proposals and what they led to, its cost in full (never in euros, linked to Votre consommation), « ↳ suite de »,
 * the link to its object and, for a reply the thread shows, « Voir dans la conversation ». At its foot, folded,
 * « Sources et outils de cette page ». `asked`: the entry « Dans l'activité » asked for, unfolded and brought into view.
 */
export function ActivityHistory({
  entries,
  inThread,
  usage,
  asked,
}: {
  entries: readonly ActivityEntry[];
  inThread: ReadonlySet<string>;
  usage: readonly QuotaUse[] | null;
  asked: { key: string; n: number } | null;
}) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const days = useMemo(() => historyByDay(entries, new Date()), [entries]);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  /** Brings the entry `key` into view, marks it a moment and puts the focus on its row. */
  const bringIntoView = (key: string) =>
    requestAnimationFrame(() => {
      const row = list.current?.querySelector(`[data-entry="${CSS.escape(key)}"]`) ?? null;
      row?.scrollIntoView?.({ block: "nearest", behavior: motion() });
      highlight(row);
      row?.querySelector<HTMLButtonElement>(".activity-entry-row")?.focus({ preventScroll: true });
    });
  /** « suite de », « a donné »: the entry `key`, unfolded, in view. */
  const reveal = (key: string) => {
    setUnfolded((was) => new Set([...was, key]));
    bringIntoView(key);
  };

  // « Dans l'activité » in the thread: its entry unfolds (each time it is asked), then comes into view.
  const [seen, setSeen] = useState<number | null>(null);
  if (asked && asked.n !== seen && byKey.has(asked.key)) {
    setSeen(asked.n);
    setUnfolded((was) => new Set([...was, asked.key]));
  }
  const askedKey = asked?.key;
  useEffect(() => {
    if (askedKey && seen !== null) bringIntoView(askedKey);
    // Once it unfolded, each time it is asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const toggle = (key: string) =>
    setUnfolded((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <>
      <section className="activity-history" aria-labelledby={titleId}>
        <h4 id={titleId} className="activity-history-title">
          {t("aiActivity.history.title")}
        </h4>
        <div ref={list}>
          {days.length === 0 ? <p className="activity-history-empty">{t("aiActivity.history.empty")}</p> : null}
          {days.map((day) => (
            <Day key={day.key} label={dayLabel(day, t, language)}>
              {day.entries.map((entry) => (
                <Entry
                  key={entry.key}
                  entry={entry}
                  open={unfolded.has(entry.key)}
                  toggle={() => toggle(entry.key)}
                  reveal={reveal}
                  byKey={byKey}
                  inThread={entry.messageId !== undefined && inThread.has(entry.messageId)}
                  cost={costShown(entry, usage)}
                />
              ))}
            </Day>
          ))}
        </div>
      </section>
      <PageSources entries={entries} />
    </>
  );
}


/** A day of the history, named by its heading (« Aujourd'hui », « Le 27/10 »). */
function Day({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="activity-day" aria-labelledby={id}>
      <h5 id={id} className="activity-day-title">
        {label}
      </h5>
      <ul className="activity-entries">{children}</ul>
    </section>
  );
}

function dayLabel(day: { today: boolean; key: string; at: string | null }, t: T, language: Language): string {
  if (day.today) return t("aiActivity.history.today");
  if (!day.at) return t("aiActivity.history.undated");
  return t("aiActivity.history.day", { date: dayOf(day.at, language) });
}

/** An entry's title: its kind, a version's number, the change a card made. */
export function entryTitle(entry: ActivityEntry, t: T): string {
  if (entry.kind === "master_cv_version") return t("aiActivity.history.titles.master_cv_version", { version: entry.result.version });
  if (entry.kind === "change") return t("aiActivity.history.titles.change", { what: entry.result.change?.what ?? "" });
  const kind = t(`aiActivity.kinds.${entry.kind}`);
  return entry.object.label && entry.kind !== "coach_reply" ? `${kind} · ${entry.object.label}` : kind;
}

/** What it gave, in words: stopped or failed, a Job Search's offers, an ATS Score's score, a version, a change, a reply's proposals. */
function resultWords(entry: ActivityEntry, t: T, language: Language): string | null {
  const { result } = entry;
  if (result.end.state !== "done") return endWords(result.end, t, language);
  if (entry.unrecorded) return t("aiActivity.modelNotRecorded");
  if (result.offers !== undefined) return t("aiActivity.history.results.offers", { count: result.offers });
  if (result.score !== undefined) return t("aiActivity.history.results.score", { score: result.score });
  if (result.change) return t("aiActivity.history.results.change", { before: result.change.before, after: result.change.after });
  if (entry.kind === "master_cv" && result.version !== undefined) return t("aiActivity.history.results.version", { version: result.version });
  if (result.restoredFrom) return t("aiActivity.history.results.restored", { version: result.restoredFrom });
  if (entry.proposals?.length) return t("aiActivity.history.results.proposals", { count: entry.proposals.length });
  return null;
}

/**
 * A stopped or failed entry's end, in words, never by its light red alone (ADR-0009): « Arrêtée à 12:04 », « Échec à
 * 12:04 » (another day, « Arrêtée le 23/10 à 12:04 »).
 */
function endWords(end: Exclude<ElementEnd, { state: "done" }>, t: T, language: Language): string {
  if (!end.at) return t(`aiActivity.ended.${end.state}Undated`);
  const at = new Date(end.at);
  const today = at.toDateString() === new Date().toDateString();
  return t(today ? `aiActivity.ended.${end.state}` : `aiActivity.ended.${end.state}On`, { time: formatTimeOfDay(at, new Date(), language) });
}

/** « 1 recherche du forfait · 4 sur 7 cette semaine », « 4 appels · 21,4k jetons envoyés », « Sans IA »: the cost on the row. */
function costInShort(cost: CostShown, t: T, language: Language): string | null {
  if (cost.quota) return quotaWords(cost.quota, t);
  if (cost.tokens) return tokenWords(cost.tokens, t, language);
  if (cost.noAi) return t("aiActivity.history.cost.noAi");
  return null;
}

function quotaWords(quota: NonNullable<CostShown["quota"]>, t: T): string {
  const used = t(`aiActivity.history.cost.quota.${quota.quota}`);
  return quota.week ? `${used} · ${t("aiActivity.history.cost.week", { used: quota.week.used, limit: quota.week.limit })}` : used;
}

function tokenWords(tokens: NonNullable<CostShown["tokens"]>, t: T, language: Language): string {
  const count = formatTokens(tokens.count, language);
  const words = tokens.calls !== null ? t("aiActivity.history.cost.calls", { count: tokens.calls, tokens: count }) : t("aiActivity.history.cost.tokens", { tokens: count });
  return tokens.partial ? `${words} · ${t("aiActivity.history.cost.partial")}` : words;
}

/** An entry: its row, a button that unfolds its detail. */
function Entry({
  entry,
  open,
  toggle,
  reveal,
  byKey,
  inThread,
  cost,
}: {
  entry: ActivityEntry;
  open: boolean;
  toggle: () => void;
  reveal: (key: string) => void;
  byKey: ReadonlyMap<string, ActivityEntry>;
  inThread: boolean;
  cost: CostShown;
}) {
  const t = useT();
  const language = useLanguage();
  const detailId = useId();
  const result = resultWords(entry, t, language);
  const short = costInShort(cost, t, language);
  const sub = [result, short].filter((part) => part !== null).join(" · ");
  return (
    <li className="activity-entry" data-entry={entry.key} data-kind={entry.kind} data-end={entry.result.end.state === "done" ? undefined : entry.result.end.state}>
      <button type="button" className="activity-entry-row" aria-expanded={open} aria-controls={detailId} onClick={toggle}>
        <ActivityGlyph activity={GLYPH[entry.kind]} />
        <span className="activity-entry-words">
          <span className="activity-entry-title">{entryTitle(entry, t)}</span>
          {sub ? <span className="activity-entry-sub">{sub}</span> : null}
        </span>
        {entry.at ? (
          <time className="activity-entry-time" dateTime={entry.at}>
            {timeOf(entry.at, language)}
          </time>
        ) : null}
        <Icons.chevron />
      </button>
      <div id={detailId} className="activity-entry-detail" hidden={!open}>
        {open ? <Detail entry={entry} reveal={reveal} byKey={byKey} inThread={inThread} cost={cost} /> : null}
      </div>
    </li>
  );
}

/** A link to another entry (« suite de », « a donné »): unfolds it and brings it into view. */
function EntryLink({ to, byKey, reveal }: { to: string; byKey: ReadonlyMap<string, ActivityEntry>; reveal: (key: string) => void }) {
  const t = useT();
  const language = useLanguage();
  const entry = byKey.get(to);
  if (!entry) return null;
  return (
    <button type="button" className="activity-entry-link" onClick={() => reveal(to)}>
      {entryTitle(entry, t)}
      {entry.at ? ` · ${timeOf(entry.at, language)}` : ""}
    </button>
  );
}

function Detail({ entry, reveal, byKey, inThread, cost }: { entry: ActivityEntry; reveal: (key: string) => void; byKey: ReadonlyMap<string, ActivityEntry>; inThread: boolean; cost: CostShown }) {
  const t = useT();
  const language = useLanguage();
  const column = useActivityColumn();
  const toolNames = entry.tools.map((tool) => tool.name ?? t("aiActivity.rules"));
  const showInConversation = () => {
    const message = entry.messageId ? document.querySelector(messageAnchor(entry.messageId)) : null;
    if (!message) return;
    // On a phone, Activity covers the conversation: it closes first.
    column?.closeOverConversation();
    requestAnimationFrame(() => {
      message.scrollIntoView?.({ block: "center", behavior: motion() });
      highlight(message);
    });
  };
  return (
    <>
      <p className="activity-entry-origin">{t(`aiActivity.history.origin.${entry.origin}`)}</p>
      {entry.question ? <p className="activity-entry-question">{t("aiActivity.history.you", { question: entry.question })}</p> : null}
      {entry.steps.length > 0 ? (
        <ol className="activity-entry-steps" aria-label={t("aiActivity.history.steps")}>
          {entry.steps.map((step, index) => (
            <Step key={index} step={step} />
          ))}
        </ol>
      ) : null}
      {entry.read?.length ? (
        <Line label={t("aiActivity.history.read")}>
          {entry.read.map((element, index) => (
            <span key={index}>
              {index > 0 ? ", " : null}
              <ConsultedLabel element={element} />
            </span>
          ))}
        </Line>
      ) : null}
      {toolNames.length > 0 ? <Line label={t("aiActivity.history.tools")}>{toolNames.join(", ")}</Line> : null}
      {entry.models.length > 0 ? (
        <Line label={t("aiActivity.history.models")}>
          {entry.models.map((model, index) => (
            <span key={`${model.name}-${index}`} title={model.ids.join(", ")}>
              {index > 0 ? ", " : null}
              {model.name}
              {model.where ? ` (${model.where[language]})` : null}
            </span>
          ))}
        </Line>
      ) : null}
      {entry.unrecorded ? <p className="ai-activity-meta">{t("aiActivity.modelNotRecorded")}</p> : null}
      {entry.proposals?.length ? <Proposals proposals={entry.proposals} byKey={byKey} reveal={reveal} /> : null}
      <FullCost cost={cost} />
      {entry.after ? (
        <p className="activity-entry-after">
          {t("aiActivity.history.after")} <EntryLink to={entry.after} byKey={byKey} reveal={reveal} />
        </p>
      ) : null}
      <p className="activity-entry-links">
        {entry.object.href ? <Link href={entry.object.href}>{t(`aiActivity.history.open.${entry.kind}`, { label: entry.object.label ?? "" })}</Link> : null}
        {inThread ? (
          <button type="button" className="activity-entry-link" onClick={showInConversation}>
            {t("aiActivity.history.inConversation")}
          </button>
        ) : null}
      </p>
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="activity-entry-line">
      <span className="activity-entry-label">{label}</span> {children}
    </p>
  );
}

/** A step: its glyph, its label, its Tool or model, how many calls it folds, what it saw. */
function Step({ step }: { step: EntryStep }) {
  const t = useT();
  const by = step.tool ?? step.model ?? (step.label === "compute" ? t("aiActivity.rules") : null);
  return (
    <li className="activity-entry-step">
      <span className="activity-entry-step-done" aria-hidden>
        <Icons.done />
      </span>
      <span>
        {t(`aiActivity.steps.${step.label}`)}
        {by ? ` · ${by}` : null}
        {step.count > 1 ? ` · ${t("aiActivity.history.calls", { count: step.count })}` : null}
        {step.seen.length > 0 ? " · " : null}
        {step.seen.map((element, index) => (
          <span key={index}>
            {index > 0 ? ", " : null}
            <ConsultedLabel element={element} />
          </span>
        ))}
      </span>
    </li>
  );
}

/** A reply's proposals, each with its state, and « → a donné … » for one applied. */
function Proposals({ proposals, byKey, reveal }: { proposals: readonly EntryProposal[]; byKey: ReadonlyMap<string, ActivityEntry>; reveal: (key: string) => void }) {
  const t = useT();
  return (
    <ul className="activity-entry-proposals" aria-label={t("aiActivity.history.proposals")}>
      {proposals.map((proposal, index) => (
        <li key={index}>
          <span>
            {proposal.what} : {proposal.before} → {proposal.after}
          </span>{" "}
          <span className="pill" data-tone={proposal.state === "applied" ? "success" : proposal.state === "pending" ? "accent" : undefined}>
            {t(`aiActivity.history.state.${proposal.state}`)}
          </span>
          {proposal.led ? (
            <span className="activity-entry-led">
              {" "}
              {t("aiActivity.history.led")} <EntryLink to={proposal.led} byKey={byKey} reveal={reveal} />
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Its cost in full, never in euros: the Plan Quota with the week's use, or « compté dans votre consommation », its tokens, or « Sans IA ». */
function FullCost({ cost }: { cost: CostShown }) {
  const t = useT();
  const language = useLanguage();
  const parts: ReactNode[] = [];
  if (cost.quota) parts.push(<Link key="quota" href={CONSUMPTION}>{quotaWords(cost.quota, t)}</Link>);
  else if (cost.consumption) parts.push(<Link key="consumption" href={CONSUMPTION}>{t("aiActivity.history.cost.consumption")}</Link>);
  if (cost.tokens) parts.push(<span key="tokens">{tokenWords(cost.tokens, t, language)}</span>);
  if (cost.noAi) parts.push(<span key="noAi" className="pill">{t("aiActivity.history.cost.noAi")}</span>);
  if (parts.length === 0) return null;
  return (
    <Line label={t("aiActivity.history.cost.label")}>
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? " · " : null}
          {part}
        </span>
      ))}
    </Line>
  );
}

/** « Sources et outils de cette page », folded at the foot: each Provenance site once (its pages a disclosure), each Tool once. */
function PageSources({ entries }: { entries: readonly ActivityEntry[] }) {
  const t = useT();
  const { sites, tools } = useMemo(() => pageSources(entries), [entries]);
  const [open, setOpen] = useState(false);
  const id = useId();
  if (sites.length === 0 && tools.length === 0) return null;
  return (
    <section className="activity-sources">
      <h4>
        <button type="button" className="ai-activity-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)}>
          <Icons.chevron />
          {t("aiActivity.history.sources")}
        </button>
      </h4>
      <ul id={id} className="ai-activity-list" hidden={!open}>
        {sites.map((site) => (
          <li key={site.kind === "web" ? site.domain : "candidate"}>
            <SiteDisclosure site={site} />
          </li>
        ))}
        {tools.map((tool) => (
          <li key={tool.name ?? "rules"}>
            <ToolName tool={tool} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A Tool by its logo (where its owner allowed it) and name, or « J » for Jobbbox's rules. */
function ToolName({ tool }: { tool: ActivityTool }) {
  const t = useT();
  return (
    <span className="ai-activity-tool">
      {tool.logo ? (
        <img className="ai-activity-logo" src={tool.logo} alt="" />
      ) : (
        <span className="ai-activity-glyph" aria-hidden="true">
          {tool.name === null ? PROVENANCE_GLYPHS.rules : "⚙"}
        </span>
      )}
      {tool.name ?? t("aiActivity.rules")}
    </span>
  );
}

/** A Provenance site: a disclosure button opening the pages read, each in a new tab without a referrer. */
function SiteDisclosure({ site }: { site: ProvenanceSite }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const name = site.kind === "web" ? site.domain : t("aiActivity.yourData");
  const glyph = site.kind === "web" ? PROVENANCE_GLYPHS.site : PROVENANCE_GLYPHS.candidate;
  const label = (
    <>
      <span className="ai-activity-glyph" aria-hidden="true">
        {glyph}
      </span>
      {name}
    </>
  );
  if (site.links.length === 0) return <span className="ai-activity-site">{label}</span>;
  return (
    <>
      <button type="button" className="ai-activity-disclosure ai-activity-site" aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)}>
        {label}
      </button>
      <ul id={id} className="ai-activity-links" hidden={!open}>
        {site.links.map((link) => (
          <li key={link}>
            {site.kind === "web" ? (
              <ExternalLink href={link}>
                {link.replace(/^https?:\/\/(www\.)?/, "")}
                <span className="visually-hidden"> {t("aiActivity.newTab")}</span>
              </ExternalLink>
            ) : (
              <Link href={link}>{link}</Link>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
