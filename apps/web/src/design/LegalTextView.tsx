"use client";

import { LEGAL_TEXTS, type LegalTextHistoryEntry, type LegalTextId, type LegalTextVersion, type ShownLegalText } from "@jobhub/help";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CoachReplyText } from "@/components/CoachReplyText";
import { Icons } from "@/components/icons";
import { writtenDay } from "@/public-pages/days";
import { routes } from "@/routes";
import { buttonClass } from "./button-class";
import { EmptyState } from "./EmptyState";
import { Note } from "./Note";
import "./LegalTextView.css";

const CURRENT_PAGE = "page";
const CURRENT_LOCATION = "location";

/**
 * A Legal Text on Légal (ADR-0062, layout of #470): the Legal Texts on the left, the version in a reading column (its
 * title, effective date, « Versions précédentes », « En bref », numbered sections, who approved it, « Télécharger en
 * PDF »), and « Sur cette page » on the right, following the reading. Both side columns stay in view to the end of a
 * long text. A dated version no longer in effect says it is archived, a substantial one still to come that it is upcoming
 * (#547); the English translation says the French text
 * prevails. A text the team has not written yet shows that it is not published.
 */
export function LegalTextView({ text, shown }: { text: LegalTextId; shown: ShownLegalText | null }) {
  const { t, i18n } = useTranslation();
  const summaryId = useId();
  const version = shown?.version;
  return (
    <LegalLayout text={text} aside={version ? <OnThisPage sections={version.sections} /> : <span />}>
      <h1 className="ds-legal__title">{version?.title ?? t(`legal.texts.${text}`)}</h1>
      {!shown || !version ? (
        <EmptyState title={t("legal.notPublishedTitle")}>{t("legal.notPublished")}</EmptyState>
      ) : (
        <>
          {version.locale !== "fr" ? (
            <Note>
              <p>
                {t("legal.translation")} <Link href={`${routes.legal(text, shown.inEffect ? undefined : version.effective)}?lang=fr`}>{t("legal.readFrench")}</Link>
              </p>
            </Note>
          ) : null}
          <div className="ds-legal__stamp">
            <span>{t(shown.upcoming ? "legal.effectiveFrom" : "legal.effective", { date: writtenDay(version.effective, i18n.language) })}</span>
            {shown.history.length > 1 ? <Link href={routes.legalVersions(text)}>{t("legal.earlierVersions")}</Link> : null}
          </div>
          {shown.upcoming ? (
            <Note>
              <p>
                {t("legal.upcoming", { date: writtenDay(version.effective, i18n.language) })} <Link href={routes.legal(text)}>{t("legal.seeCurrent")}</Link>
              </p>
            </Note>
          ) : !shown.inEffect ? (
            <Note tone="warn">
              <p>
                {t("legal.archived")} <Link href={routes.legal(text)}>{t("legal.seeCurrent")}</Link>
              </p>
            </Note>
          ) : null}
          {version.inBrief.length > 0 ? (
            <section className="ds-legal__summary" aria-labelledby={summaryId}>
              <h2 id={summaryId}>{t("legal.summary")}</h2>
              <ul>
                {version.inBrief.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {version.sections.map((section) => (
            <section key={section.id} className="ds-legal__section">
              <h2 id={section.id}>
                <span className="ds-legal__number">{section.number}.</span>
                {section.title}
              </h2>
              <CoachReplyText text={section.body} />
            </section>
          ))}
          <div className="ds-legal__foot">
            <p className="ds-legal__approval">{t("legal.approvedBy", { name: version.approvedBy, date: writtenDay(version.effective, i18n.language) })}</p>
            <a className={buttonClass({ size: "sm" })} href={routes.legalPdf(text, version.effective, i18n.language)} download>
              <Icons.download />
              {t("legal.pdf")}
            </a>
          </div>
        </>
      )}
    </LegalLayout>
  );
}

/**
 * A Legal Text's version history (/legal/<text>/versions): each version in effect so far, newest first, its date
 * (the link to its permanent address), « Substantielle » or « Mineure » and its line.
 */
export function LegalTextHistoryView({ text, history }: { text: LegalTextId; history: LegalTextHistoryEntry[] }) {
  const { t, i18n } = useTranslation();
  return (
    <LegalLayout text={text} aside={<span />}>
      <h1 className="ds-legal__title">{t("legal.history")}</h1>
      {history.length === 0 ? (
        <EmptyState title={t("legal.notPublishedTitle")}>{t("legal.notPublished")}</EmptyState>
      ) : (
        <>
          <p className="ds-legal__stamp">{t("legal.historyIntro")}</p>
          <ul className="ds-legal__history">
            {history.map((entry) => (
              <li key={entry.effective}>
                <Link href={entry.url}>{t("legal.historyVersion", { date: writtenDay(entry.effective, i18n.language) })}</Link>
                <span className="ds-legal__change" data-change={entry.change}>
                  {t(`legal.change.${entry.change}`)}
                </span>
                <p>{entry.summary}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </LegalLayout>
  );
}

/** Légal's three columns: the Legal Texts, the reading column (eyebrow « Légal », then `children`), and `aside`. */
function LegalLayout({ text, aside, children }: { text: LegalTextId; aside: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="ds-legal">
      <nav className="ds-legal__documents" aria-label={t("legal.documentsNav")}>
        <span className="ds-legal__group" aria-hidden>
          {t("legal.eyebrow")}
        </span>
        {LEGAL_TEXTS.map((entry) => (
          <Link key={entry} href={routes.legal(entry)} aria-current={entry === text ? CURRENT_PAGE : undefined}>
            {t(`legal.texts.${entry}`)}
          </Link>
        ))}
      </nav>
      <article className="ds-legal__text">
        <p className="ds-legal__eyebrow">{t("legal.eyebrow")}</p>
        {children}
      </article>
      {aside}
    </div>
  );
}

/** « Sur cette page »: a link per section, the one being read marked (`aria-current`) as the page scrolls. */
function OnThisPage({ sections }: { sections: LegalTextVersion["sections"] }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(sections[0]?.id);
  useEffect(() => {
    function follow() {
      // The section being read: the last whose heading has gone past the top third of the window.
      const line = window.innerHeight / 3;
      let reading = sections[0]?.id;
      for (const section of sections) {
        const heading = window.document.getElementById(section.id);
        if (heading && heading.getBoundingClientRect().top <= line) reading = section.id;
      }
      // At the very end of the page, the last section is the one read, however short.
      if (window.innerHeight + window.scrollY >= window.document.documentElement.scrollHeight - 2) reading = sections.at(-1)?.id;
      setCurrent(reading);
    }
    follow();
    window.addEventListener("scroll", follow, { passive: true });
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("scroll", follow);
      window.removeEventListener("resize", follow);
    };
  }, [sections]);
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    // A « Sur cette page » taller than the window scrolls within itself: the section being read stays in it.
    const nav = list.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !link) return;
    if (link.offsetTop < nav.scrollTop) nav.scrollTop = link.offsetTop;
    else if (link.offsetTop + link.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = link.offsetTop + link.offsetHeight - nav.clientHeight;
  }, [current]);
  return (
    <nav ref={list} className="ds-legal__toc" aria-label={t("legal.toc")}>
      <span className="ds-legal__group" aria-hidden>
        {t("legal.toc")}
      </span>
      {sections.map((section) => (
        <a key={section.id} href={`#${section.id}`} aria-current={section.id === current ? CURRENT_LOCATION : undefined}>
          {section.title}
        </a>
      ))}
    </nav>
  );
}
