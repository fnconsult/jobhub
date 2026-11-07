"use client";

import { importanceTier, offerBoxView, postingAge, type OfferBoxDay, type OfferBoxFilter } from "@jobhub/shared";
import { DISMISSAL_REASONS, type DismissalReason, type OfferBoxEntryRead, type OfferBoxResponse } from "@jobhub/shared/reads";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { EmptyState } from "@/design/EmptyState";
import { useHydrated } from "@/design/hydrated";
import { Pill } from "@/design/Pill";
import { ToastProvider, useToast } from "@/design/Toast";
import { routes } from "@/routes";
import "./OfferBox.css";

/**
 * Recherches d'offres' main view, the Offer box (« Offres à traiter », ADR-0090, variant B): the page itself, the menu's
 * conversation following it. Its header (« N à traiter », « k traitées », a progress bar) and the source chips stay at
 * the top while it scrolls; « Aujourd'hui » then « Précédemment », each by Importance tier, their headings staying under
 * the header too. Each line: its Match Score, title, employer, place, contract, source chips, posting age and Profile,
 * « Suivre » (its Application, « À postuler »), « Écarter » (its Dismissal reasons or « Écarter sans motif », then a toast
 * with « Annuler », which takes the keyboard focus, #816; an « Annuler » that fails says so above the entries) and « Lire
 * l'offre » (the Work Pane), and « Plus tard » (#817: away until Monday, a toast with « Annuler »). Its buttons wait,
 * disabled, until the page is hydrated (#446). An entry « À ne pas manquer » still à traiter is set off by a border
 * turning slowly (still under reduced motion). Each tier of « Précédemment » with two entries or more offers « Tout
 * écarter (n) » (#817): those the source chip shows, without a reason, a toast with « Annuler ». Then, folded, « Plus
 * tard » (each « revient lundi n », still counted), « Expirées sans décision » (out of the count, « Écarter » only) and
 * « Écartées », each with « Revenir sur ce choix »; then « Recherches par Profil » and « Reçues par email », which open
 * in the Work Pane. Laid out by `offerBoxView`, as the app does.
 */
/**
 * What a line's « Écarter » or « Plus tard », or a tier's « Tout écarter », needs from the page once its own button is
 * gone: the box's heading, where the focus goes back when the toast closes, and how to say that « Annuler » failed
 * (null: it did not).
 */
const OfferBoxPageHandle = createContext<{ heading: () => HTMLElement | null; undoFailed: (message: string | null) => void }>({ heading: () => null, undoFailed: () => {} });

export function OfferBox({ box }: { box: OfferBoxResponse }) {
  return (
    <ToastProvider>
      <OfferBoxPage box={box} />
    </ToastProvider>
  );
}

function OfferBoxPage({ box }: { box: OfferBoxResponse }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const view = offerBoxView(box, filter);
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [undoFailed, setUndoFailed] = useState<string | null>(null);
  const [handle] = useState(() => ({ heading: () => heading.current, undoFailed: setUndoFailed }));
  const total = view.toHandle + view.treated;

  // The day's and the tier's headings stay under the header, whatever height its chips wrap to.
  useEffect(() => {
    const header = head.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const measure = () => root.current?.style.setProperty("--offer-box-head", `${header.offsetHeight}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <OfferBoxPageHandle.Provider value={handle}>
      <section ref={root} className="offer-box" aria-labelledby={titleId}>
        <div ref={head} className="offer-box-head">
          <div className="offer-box-count">
            <h2 id={titleId} ref={heading} tabIndex={-1}>
              {t("offerBox.title")}
            </h2>
            <p aria-live="polite">
              <b>{view.toHandle}</b> {t("offerBox.toHandle")}
              <span>{t("offerBox.treated", { count: view.treated })}</span>
            </p>
          </div>
          <div
            className="offer-box-progress"
            role="progressbar"
            aria-label={t("offerBox.progress", { treated: view.treated, total })}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={view.treated}
          >
            <i style={{ width: `${total === 0 ? 100 : Math.round((100 * view.treated) / total)}%` }} />
          </div>
          <div className="offer-box-chips" role="group" aria-label={t("offerBox.chips")}>
            {view.chips.map(({ source, toHandle }) => (
              <button
                key={source}
                type="button"
                className="offer-box-chip"
                aria-pressed={filter === source}
                aria-label={t("offerBox.chipCount", { source: t(`offerBox.sources.${source}`), count: toHandle })}
                onClick={() => setFilter(source)}
              >
                {t(`offerBox.sources.${source}`)}
                <span className="offer-box-chip-count">{toHandle}</span>
              </button>
            ))}
          </div>
        </div>

        {undoFailed ? (
          <p className="field-error" role="alert">
            {undoFailed}
          </p>
        ) : null}

        {box.entries.length === 0 ? (
          <EmptyState headingLevel={3} title={t("offerBox.empty")}>{t("offerBox.emptyText")}</EmptyState>
        ) : (
          <>
            {view.toHandle === 0 ? <EmptyState headingLevel={3} title={t("offerBox.allDone")}>{t("offerBox.allDoneText")}</EmptyState> : null}
            <OfferBoxDaySection name={t("offerBox.today")} day={view.today} today={box.today} nothing={t("offerBox.nothingToday")} followed={(count) => t("offerBox.followedToday", { count })} />
            <OfferBoxDaySection
              name={t("offerBox.earlier")}
              day={view.earlier}
              today={box.today}
              nothing={t("offerBox.nothingEarlier")}
              followed={(count) => t("offerBox.followedEarlier", { count })}
              showDay
              dismissAll
            />
          </>
        )}

        <FoldedEntries summary={t("offerBox.laterBlock", { count: view.later.length })} hint={t("offerBox.laterHint")} entries={view.later} today={box.today} />
        <FoldedEntries summary={t("offerBox.expiredBlock", { count: view.expired.length })} hint={t("offerBox.expiredHint")} entries={view.expired} today={box.today} />
        <FoldedEntries summary={t("offerBox.dismissedBlock", { count: view.dismissed.length })} hint={t("offerBox.dismissedHint")} entries={view.dismissed} today={box.today} />

        <p className="offer-box-foot">
          <Link href={routes.jobSearchesByProfile}>{t("offerBox.byProfile")}</Link>
          <Link href={routes.receivedByEmail}>{t("offerBox.receivedByEmail")}</Link>
        </p>
      </section>
    </OfferBoxPageHandle.Provider>
  );
}

/** « Plus tard », « Expirées sans décision » or « Écartées »: folded at the foot of the box, absent when empty. */
function FoldedEntries({ summary, hint, entries, today }: { summary: string; hint: string; entries: OfferBoxEntryRead[]; today: string }) {
  if (entries.length === 0) return null;
  return (
    <details className="offer-box-followed offer-box-folded">
      <summary>{summary}</summary>
      <p className="offer-box-nothing">{hint}</p>
      <ul className="offer-box-entries">
        {entries.map((entry) => (
          <OfferBoxLine key={entry.id} entry={entry} today={today} showDay />
        ))}
      </ul>
    </details>
  );
}

/** « Tout écarter (n) » is offered on a tier of « Précédemment » from this many entries. */
const DISMISS_ALL_FROM = 2;

/** « Aujourd'hui » or « Précédemment »: its tiers (with « Tout écarter » for « Précédemment »), then its entries already suivies, folded. */
function OfferBoxDaySection({
  name,
  day,
  today,
  nothing,
  followed,
  showDay = false,
  dismissAll = false,
}: {
  name: string;
  day: OfferBoxDay;
  today: string;
  nothing: string;
  followed: (count: number) => string;
  showDay?: boolean;
  dismissAll?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <section className="offer-box-day" aria-labelledby={id}>
      <h3 id={id} className="offer-box-day-heading">
        {name}
      </h3>
      {day.tiers.length === 0 ? <p className="offer-box-nothing">{nothing}</p> : null}
      {day.tiers.map(({ tier, entries }) => (
        <section key={tier} className="offer-box-tier" data-tier={tier} aria-labelledby={`${id}-${tier}`}>
          <div className="offer-box-tier-heading">
            <h4 id={`${id}-${tier}`}>
              {t(`offerBox.tiers.${tier}`)}
              <span> · {t(`offerBox.tierHints.${tier}`)}</span>
            </h4>
            {dismissAll && entries.length >= DISMISS_ALL_FROM ? <DismissAllButton entries={entries} tierName={t(`offerBox.tiers.${tier}`)} /> : null}
          </div>
          <ul className="offer-box-entries">
            {entries.map((entry) => (
              <OfferBoxLine key={entry.id} entry={entry} today={today} showDay={showDay} />
            ))}
          </ul>
        </section>
      ))}
      {day.followed.length > 0 ? (
        <details className="offer-box-followed">
          <summary>{followed(day.followed.length)}</summary>
          <ul className="offer-box-entries">
            {day.followed.map((entry) => (
              <OfferBoxLine key={entry.id} entry={entry} today={today} showDay={showDay} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/** A day as the Offer box writes it, in French time: « 9 nov. ». */
const parisDate = (instant: string, language: string) => new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(instant));

/** One Offer box entry. */
function OfferBoxLine({ entry, today, showDay }: { entry: OfferBoxEntryRead; today: string; showDay: boolean }) {
  const { t, i18n } = useTranslation();
  const { jobOffer } = entry;
  const tier = importanceTier(entry.matchScore);
  const age = postingAge({ postedAt: jobOffer.postedAt, firstArrivalAt: entry.firstArrivalAt }, today);
  const arrivedOn = parisDate(`${entry.arrivalDay}T12:00:00Z`, i18n.language);
  const facts = [jobOffer.employer, jobOffer.location, jobOffer.contractType ? t(`cvReview.contractTypes.${jobOffer.contractType}`) : null].filter((fact): fact is string => Boolean(fact));
  const posted = age.postedDaysAgo === null ? null : age.postedDaysAgo === 0 ? t("offerBox.postedToday") : t("offerBox.postedAgo", { count: age.postedDaysAgo });
  const titleId = useId();
  return (
    <li className="offer-box-entry" data-tier={tier} data-state={entry.state} aria-label={jobOffer.title}>
      <span className="offer-box-score" aria-label={entry.matchScore === null ? t("offerBox.noScore") : t("offerBox.score", { score: entry.matchScore })} role="img">
        {entry.matchScore ?? "—"}
        <small aria-hidden>{entry.matchScore === null ? t("offerBox.notComputable") : "/100"}</small>
      </span>
      <p className="offer-box-title" id={titleId}>
        <Link href={routes.offerBoxOffer(jobOffer.id)}>{jobOffer.title}</Link>
        {entry.state === "followed" ? <Pill tone="success">{t("offerBox.followed")}</Pill> : null}
        {entry.state === "later" && entry.laterUntil ? <Pill tone="accent">{t("offerBox.laterUntil", { date: parisDate(entry.laterUntil, i18n.language) })}</Pill> : null}
        {entry.state === "dismissed" ? (
          <Pill>{entry.dismissalReason ? t("offerBox.dismissedWithReason", { reason: t(`offerBox.dismissalReasons.${entry.dismissalReason}`) }) : t("offerBox.dismissed")}</Pill>
        ) : null}
      </p>
      {facts.length > 0 ? <p className="offer-box-facts">{facts.join(" · ")}</p> : null}
      <p className="offer-box-tags">
        {showDay ? <span className="offer-box-arrived">{t("offerBox.arrivedOn", { date: arrivedOn })}</span> : null}
        {entry.sources.map(({ source }) => (
          <span key={source} className="offer-box-source">
            {t(`offerBox.sources.${source}`)}
          </span>
        ))}
        {posted || age.leavesInDays !== null ? (
          <span className="offer-box-age" data-soon={age.leavesInDays !== null || undefined}>
            {[posted, age.leavesInDays !== null ? t("offerBox.leavesIn", { count: age.leavesInDays }) : null].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        <span className="offer-box-profile">{entry.profile?.name ?? t("offerBox.unsorted")}</span>
      </p>
      <div className="offer-box-actions">
        {entry.state === "followed" && entry.applicationId ? (
          <Link className={buttonClass({ size: "sm" })} href={routes.application(entry.applicationId)} aria-describedby={titleId}>
            {t("offerBox.seeApplication")}
          </Link>
        ) : entry.state === "dismissed" ? (
          <ReconsiderButton entry={entry} />
        ) : entry.state !== "expired" && entry.scoredWith ? (
          <FollowButton jobOfferId={jobOffer.id} profileId={entry.scoredWith.id} describedBy={titleId} />
        ) : null}
        {entry.state === "to_handle" || entry.state === "later" || entry.state === "expired" ? <DismissButton entry={entry} describedBy={titleId} /> : null}
        {entry.state === "to_handle" ? <LaterButton entry={entry} /> : null}
        <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={routes.offerBoxOffer(jobOffer.id)} aria-describedby={titleId}>
          {t("offerBox.read")}
        </Link>
      </div>
    </li>
  );
}

/** « Suivre »: saves the Job Offer as an Application (« À postuler ») with the entry's Profile; the page then shows it « Suivie ». */
function FollowButton({ jobOfferId, profileId, describedBy }: { jobOfferId: string; profileId: string; describedBy: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const hydrated = useHydrated();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function follow() {
    setWorking(true);
    setFailed(false);
    const status = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobOfferId, profileId }) }).then(
      (response) => response.status,
      () => 0,
    );
    if (status === 200 || status === 201) {
      router.refresh();
      return;
    }
    setWorking(false);
    setFailed(true);
  }

  return (
    <>
      <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={follow} disabled={!hydrated || working} aria-describedby={describedBy}>
        {working ? t("offerBox.following") : t("offerBox.follow")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("offerBox.followError")}
        </p>
      ) : null}
    </>
  );
}

/** « Écarter » (`POST`) or « Revenir sur ce choix » (`DELETE`) one entry: whether it was done. */
async function decide(entryId: string, method: "POST" | "DELETE", reason?: DismissalReason | null): Promise<boolean> {
  const init: RequestInit =
    method === "POST" ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: reason ?? null }) } : { method };
  const status = await fetch(`/api/offer-box/${encodeURIComponent(entryId)}/dismissal`, init).then(
    (response) => response.status,
    () => 0,
  );
  return status === 204;
}

/**
 * « Écarter »: opens « Pourquoi ? (facultatif) », the Dismissal reasons and « Écarter sans motif ». Once écartée, the
 * page refreshes (the entry leaves the count, into « Écartées ») and a toast says so, with « Annuler », which takes the
 * keyboard focus since this line's buttons go; the toast closed, the focus goes to the box's heading. An « Annuler »
 * that fails is said above the entries.
 */
function DismissButton({ entry, describedBy }: { entry: OfferBoxEntryRead; describedBy: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const page = useContext(OfferBoxPageHandle);
  const hydrated = useHydrated();
  const reasonsId = useId();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const title = entry.jobOffer.title;

  async function dismiss(reason: DismissalReason | null) {
    setWorking(true);
    setFailed(false);
    page.undoFailed(null);
    const done = await decide(entry.id, "POST", reason);
    setWorking(false);
    if (!done) {
      setFailed(true);
      return;
    }
    setOpen(false);
    toast({
      message: t("offerBox.dismissedToast", { title }),
      action: {
        label: t("offerBox.undo"),
        focus: true,
        onAction: () =>
          void decide(entry.id, "DELETE").then((undone) => {
            page.undoFailed(undone ? null : t("offerBox.undoError"));
            if (undone) router.refresh();
          }),
      },
      returnFocus: page.heading,
    });
    router.refresh();
  }

  return (
    <>
      <button
        className={buttonClass({ size: "sm" })}
        type="button"
        aria-expanded={open}
        aria-controls={open ? reasonsId : undefined}
        aria-describedby={describedBy}
        disabled={!hydrated}
        onClick={() => setOpen(!open)}
      >
        {t("offerBox.dismiss")}
      </button>
      {open ? (
        <div id={reasonsId} className="offer-box-reasons" role="group" aria-label={t("offerBox.dismissWhy")}>
          <span aria-hidden>{t("offerBox.dismissWhy")}</span>
          {DISMISSAL_REASONS.map((reason) => (
            <button key={reason} className={buttonClass({ size: "sm" })} type="button" disabled={!hydrated || working} onClick={() => void dismiss(reason)}>
              {t(`offerBox.dismissalReasons.${reason}`)}
            </button>
          ))}
          <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={!hydrated || working} onClick={() => void dismiss(null)}>
            {t("offerBox.dismissWithoutReason")}
          </button>
        </div>
      ) : null}
      {failed ? (
        <p className="field-error" role="alert">
          {t("offerBox.dismissError")}
        </p>
      ) : null}
    </>
  );
}

/** « Revenir sur ce choix »: the entry écartée is à traiter again, and the page refreshes. */
function ReconsiderButton({ entry }: { entry: OfferBoxEntryRead }) {
  const { t } = useTranslation();
  const router = useRouter();
  const hydrated = useHydrated();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function reconsider() {
    setWorking(true);
    setFailed(false);
    if (await decide(entry.id, "DELETE")) {
      router.refresh();
      return;
    }
    setWorking(false);
    setFailed(true);
  }

  return (
    <>
      <button
        className={buttonClass({ size: "sm" })}
        type="button"
        disabled={!hydrated || working}
        aria-label={t("offerBox.reconsiderLabel", { title: entry.jobOffer.title })}
        onClick={() => void reconsider()}
      >
        {t("offerBox.reconsider")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("offerBox.reconsiderError")}
        </p>
      ) : null}
    </>
  );
}

/** A write to the Offer box: its answer's status and body (0 and null when it did not reach the server). */
async function send(path: string, method: "POST" | "DELETE", body?: unknown): Promise<{ status: number; json: unknown }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(path, init).catch(() => null);
  if (!response) return { status: 0, json: null };
  return { status: response.status, json: await response.json().catch(() => null) };
}

/**
 * « Plus tard » (#817): the entry away until the next Monday 00:00 Paris time, no date to pick. Once done, the page
 * refreshes (the entry into « Plus tard », still counted) and a toast says when it comes back, with « Annuler », which
 * takes the keyboard focus since this line's buttons go.
 */
function LaterButton({ entry }: { entry: OfferBoxEntryRead }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const page = useContext(OfferBoxPageHandle);
  const hydrated = useHydrated();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const path = `/api/offer-box/${encodeURIComponent(entry.id)}/later`;

  async function later() {
    setWorking(true);
    setFailed(false);
    page.undoFailed(null);
    const { status, json } = await send(path, "POST");
    setWorking(false);
    const laterUntil = json && typeof json === "object" && "laterUntil" in json && typeof json.laterUntil === "string" ? json.laterUntil : null;
    if (status !== 200 || !laterUntil) {
      setFailed(true);
      return;
    }
    toast({
      message: t("offerBox.laterToast", { title: entry.jobOffer.title, date: parisDate(laterUntil, i18n.language) }),
      action: {
        label: t("offerBox.undo"),
        focus: true,
        onAction: () =>
          void send(path, "DELETE").then(({ status: undone }) => {
            page.undoFailed(undone === 204 ? null : t("offerBox.laterUndoError"));
            if (undone === 204) router.refresh();
          }),
      },
      returnFocus: page.heading,
    });
    router.refresh();
  }

  return (
    <>
      <button
        className={buttonClass({ variant: "quiet", size: "sm" })}
        type="button"
        disabled={!hydrated || working}
        aria-label={t("offerBox.laterLabel", { title: entry.jobOffer.title })}
        onClick={() => void later()}
      >
        {t("offerBox.later")}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("offerBox.laterError")}
        </p>
      ) : null}
    </>
  );
}

/**
 * « Tout écarter (n) » on a tier of « Précédemment » (#817): the entries it shows, within the source chip, écartées
 * without a reason. Then the page refreshes and a toast says how many, with « Annuler », which puts back exactly those.
 */
function DismissAllButton({ entries, tierName }: { entries: OfferBoxEntryRead[]; tierName: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const page = useContext(OfferBoxPageHandle);
  const hydrated = useHydrated();
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function dismissAll() {
    setWorking(true);
    setFailed(false);
    page.undoFailed(null);
    const { status, json } = await send("/api/offer-box/dismissals", "POST", { entryIds: entries.map((entry) => entry.id) });
    setWorking(false);
    const dismissed = json && typeof json === "object" && "dismissed" in json && Array.isArray(json.dismissed) ? (json.dismissed as string[]) : null;
    if (status !== 200 || !dismissed) {
      setFailed(true);
      return;
    }
    toast({
      message: t("offerBox.dismissedAllToast", { count: dismissed.length }),
      action: {
        label: t("offerBox.undo"),
        focus: true,
        onAction: () =>
          void send("/api/offer-box/dismissals", "DELETE", { entryIds: dismissed }).then(({ status: undone }) => {
            page.undoFailed(undone === 204 ? null : t("offerBox.undoAllError"));
            if (undone === 204) router.refresh();
          }),
      },
      returnFocus: page.heading,
    });
    router.refresh();
  }

  return (
    <>
      <button
        className={buttonClass({ variant: "quiet", size: "sm" })}
        type="button"
        disabled={!hydrated || working}
        aria-label={t("offerBox.dismissAllLabel", { tier: tierName, count: entries.length })}
        onClick={() => void dismissAll()}
      >
        {t("offerBox.dismissAll", { count: entries.length })}
      </button>
      {failed ? (
        <p className="field-error" role="alert">
          {t("offerBox.dismissAllError")}
        </p>
      ) : null}
    </>
  );
}
