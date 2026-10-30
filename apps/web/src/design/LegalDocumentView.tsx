"use client";

import { compareLegalVersions, LEGAL_DOCUMENTS, type LegalDocument, type LegalDocumentId } from "@jobhub/help";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoachReplyText } from "@/components/CoachReplyText";
import { Icons } from "@/components/icons";
import { writtenDay } from "@/public-pages/days";
import { routes } from "@/routes";
import { buttonClass } from "./button-class";
import { EmptyState } from "./EmptyState";
import { Note } from "./Note";
import "./LegalDocumentView.css";

const CURRENT_PAGE = "page";
const CURRENT_LOCATION = "location";

/** What the Légal page shows of one Legal Document: `legalDocument(…)` from @jobhub/help, null while not written. */
export type ShownLegalDocument = { document: LegalDocument; earlier: { version: string; effective: string }[] } | null;

/**
 * A Legal Document on the Légal page (#470): the Legal Documents on the left, the text in a reading column (its
 * title, effective date and version, « Versions précédentes », « En bref », numbered sections, « Télécharger en
 * PDF »), and « Sur cette page » on the right, following the reading. Both side columns stay in view to the end of a
 * long text. A document the team has not written yet shows that it is not published.
 */
export function LegalDocumentView({ id, shown }: { id: LegalDocumentId; shown: ShownLegalDocument }) {
  const { t, i18n } = useTranslation();
  const summaryId = useId();
  const document = shown?.document;
  const latest = shown && shown.earlier.every((entry) => compareLegalVersions(entry.version, shown.document.version) < 0);
  return (
    <div className="ds-legal">
      <nav className="ds-legal__documents" aria-label={t("legal.documentsNav")}>
        <span className="ds-legal__group" aria-hidden>
          {t("legal.eyebrow")}
        </span>
        {LEGAL_DOCUMENTS.map((entry) => (
          <Link key={entry} href={routes.legal(entry)} aria-current={entry === id ? CURRENT_PAGE : undefined}>
            {t(`legal.documents.${entry}`)}
          </Link>
        ))}
      </nav>
      <article className="ds-legal__text">
        <p className="ds-legal__eyebrow">{t("legal.eyebrow")}</p>
        <h1 className="ds-legal__title">{document?.title ?? t(`legal.documents.${id}`)}</h1>
        {!shown || !document ? (
          <EmptyState title={t("legal.notPublishedTitle")}>{t("legal.notPublished")}</EmptyState>
        ) : (
          <>
            <div className="ds-legal__stamp">
              <span>{t("legal.effective", { date: writtenDay(document.effective, i18n.language) })}</span>
              <span>{t("legal.version", { version: document.version })}</span>
              {shown.earlier.length > 0 ? (
                <details className="ds-legal__versions">
                  <summary>{t("legal.earlierVersions")}</summary>
                  <ul>
                    {shown.earlier.map((entry) => (
                      <li key={entry.version}>
                        <Link href={routes.legal(id, entry.version)}>
                          {t("legal.earlierVersion", { version: entry.version, date: writtenDay(entry.effective, i18n.language) })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
            {!latest ? (
              <Note tone="warn">
                <p>{t("legal.readingEarlier")}</p>
                <p>
                  <Link href={routes.legal(id)}>{t("legal.backToCurrent")}</Link>
                </p>
              </Note>
            ) : null}
            {document.summary.length > 0 ? (
              <section className="ds-legal__summary" aria-labelledby={summaryId}>
                <h2 id={summaryId}>{t("legal.summary")}</h2>
                <ul>
                  {document.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {document.sections.map((section) => (
              <section key={section.id} className="ds-legal__section">
                <h2 id={section.id}>
                  <span className="ds-legal__number">{section.number}.</span>
                  {section.title}
                </h2>
                <CoachReplyText text={section.body} />
              </section>
            ))}
            <div className="ds-legal__foot">
              <a className={buttonClass({ size: "sm" })} href={routes.legalPdf(id, document.version, i18n.language)} download>
                <Icons.download />
                {t("legal.pdf")}
              </a>
            </div>
          </>
        )}
      </article>
      {document ? <OnThisPage sections={document.sections} /> : <span />}
    </div>
  );
}

/** « Sur cette page »: a link per section, the one being read marked (`aria-current`) as the page scrolls. */
function OnThisPage({ sections }: { sections: LegalDocument["sections"] }) {
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
