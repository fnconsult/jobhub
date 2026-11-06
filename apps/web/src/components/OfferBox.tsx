"use client";

import { importanceTier, offerBoxView, postingAge, type OfferBoxDay, type OfferBoxFilter } from "@jobhub/shared";
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { EmptyState } from "@/design/EmptyState";
import { Pill } from "@/design/Pill";
import { routes } from "@/routes";
import "./OfferBox.css";

/**
 * Recherches d'offres' main view, the Offer box (« Offres à traiter », ADR-0090, variant B): the page itself, the menu's
 * conversation following it. Its header (« N à traiter », « k traitées », a progress bar) and the source chips stay at
 * the top while it scrolls; « Aujourd'hui » then « Précédemment », each by Importance tier, their headings staying under
 * the header too. Each line: its Match Score, title, employer, place, contract, source chips, posting age and Profile,
 * « Suivre » (its Application, « À postuler ») and « Lire l'offre » (the Work Pane). An entry « À ne pas manquer » still
 * à traiter is set off by a border turning slowly (still under reduced motion). At its foot, « Recherches par Profil » and
 * « Reçues par email » open in the Work Pane. Laid out by `offerBoxView`, as the app does.
 */
export function OfferBox({ box }: { box: OfferBoxResponse }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<OfferBoxFilter>("all");
  const view = offerBoxView(box, filter);
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
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
    <section ref={root} className="offer-box" aria-labelledby={titleId}>
      <div ref={head} className="offer-box-head">
        <div className="offer-box-count">
          <h2 id={titleId}>{t("offerBox.title")}</h2>
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
          />
        </>
      )}

      <p className="offer-box-foot">
        <Link href={routes.jobSearchesByProfile}>{t("offerBox.byProfile")}</Link>
        <Link href={routes.receivedByEmail}>{t("offerBox.receivedByEmail")}</Link>
      </p>
    </section>
  );
}

/** « Aujourd'hui » or « Précédemment »: its tiers, then its entries already suivies, folded. */
function OfferBoxDaySection({
  name,
  day,
  today,
  nothing,
  followed,
  showDay = false,
}: {
  name: string;
  day: OfferBoxDay;
  today: string;
  nothing: string;
  followed: (count: number) => string;
  showDay?: boolean;
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
          <h4 id={`${id}-${tier}`} className="offer-box-tier-heading">
            {t(`offerBox.tiers.${tier}`)}
            <span> · {t(`offerBox.tierHints.${tier}`)}</span>
          </h4>
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

/** One Offer box entry. */
function OfferBoxLine({ entry, today, showDay }: { entry: OfferBoxEntryRead; today: string; showDay: boolean }) {
  const { t, i18n } = useTranslation();
  const { jobOffer } = entry;
  const tier = importanceTier(entry.matchScore);
  const age = postingAge({ postedAt: jobOffer.postedAt, firstArrivalAt: entry.firstArrivalAt }, today);
  const arrivedOn = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(`${entry.arrivalDay}T12:00:00Z`));
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
        ) : entry.scoredWith ? (
          <FollowButton jobOfferId={jobOffer.id} profileId={entry.scoredWith.id} describedBy={titleId} />
        ) : null}
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
      <button className={buttonClass({ variant: "primary", size: "sm" })} type="button" onClick={follow} disabled={working} aria-describedby={describedBy}>
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
