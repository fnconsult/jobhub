"use client";

import { RELEASE_NOTE_TAGS, type Nouveautes, type ReleaseNote, type ReleaseNoteChangeKind, type ReleaseNoteTag } from "@jobhub/help";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoachReplyText } from "@/components/CoachReplyText";
import { writtenDay } from "@/public-pages/days";
import { buttonClass } from "./button-class";
import { EmptyState } from "./EmptyState";
import { Pill, type Tone } from "./Pill";
import "./ReleaseNotesView.css";

const CHANGE_TONE: Record<ReleaseNoteChangeKind, Tone> = { new: "accent", improved: "success", fixed: "warn" };

/**
 * The Nouveautés page's Release Notes (#470, ADR-0063), in the page's language: the filter pills (the tags the notes
 * carry), the Beta's next Version under « Version bêta, pas encore publiée », then the published ones, newest first,
 * one block each, its date and Version beside it. Until the first Release Note, it says nothing is published.
 */
export function ReleaseNotesView({ beta, published }: Nouveautes) {
  const { t } = useTranslation();
  const [tag, setTag] = useState<ReleaseNoteTag | null>(null);
  const betaId = useId();
  const publishedId = useId();
  const all = beta ? [beta, ...published] : published;
  if (all.length === 0)
    return (
      <div className="ds-releases__empty">
        <EmptyState title={t("nouveautes.emptyTitle")}>{t("nouveautes.empty")}</EmptyState>
      </div>
    );

  const tags = RELEASE_NOTE_TAGS.filter((candidate) => all.some((note) => note.tags.includes(candidate)));
  const shown = (note: ReleaseNote) => !tag || note.tags.includes(tag);
  const shownBeta = beta && shown(beta) ? beta : null;
  const shownPublished = published.filter(shown);
  const pill = (value: ReleaseNoteTag | null, label: string) => (
    <button key={value ?? "all"} type="button" className={buttonClass({ size: "sm" })} aria-pressed={tag === value} onClick={() => setTag(value)}>
      {label}
    </button>
  );

  return (
    <div className="ds-releases">
      <div className="ds-releases__filters" role="group" aria-label={t("nouveautes.filters")}>
        {pill(null, t("nouveautes.all"))}
        {tags.map((value) => pill(value, t(`nouveautes.tags.${value}`)))}
      </div>
      {shownBeta ? (
        <section className="ds-releases__beta" aria-labelledby={betaId}>
          <div className="ds-releases__beta-head">
            <h2 id={betaId}>{t("nouveautes.beta")}</h2>
            <p>{t("nouveautes.betaIntro")}</p>
          </div>
          <Release note={shownBeta} headingLevel={3} />
        </section>
      ) : null}
      <section aria-labelledby={publishedId}>
        <h2 id={publishedId} className="visually-hidden">
          {t("nouveautes.published")}
        </h2>
        {shownPublished.map((note) => (
          <Release key={note.version} note={note} headingLevel={2} />
        ))}
        {shownPublished.length === 0 && !shownBeta ? <p className="ds-releases__none">{t("nouveautes.noneForTag")}</p> : null}
      </section>
    </div>
  );
}

/** One Version's block: its date and Version on the left (sticky), its tags, title, text, image and change lines. */
function Release({ note, headingLevel }: { note: ReleaseNote; headingLevel: 2 | 3 }) {
  const { t, i18n } = useTranslation();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <article className="ds-release">
      <div className="ds-release__when">
        <time dateTime={note.date}>{writtenDay(note.date, i18n.language)}</time>
        <span className="ds-release__version">{t("nouveautes.version", { version: note.version })}</span>
      </div>
      <div className="ds-release__body">
        <div className="ds-release__tags">
          {note.tags.map((value) => (
            <Pill key={value}>{t(`nouveautes.tags.${value}`)}</Pill>
          ))}
        </div>
        <Heading className="ds-release__title">{note.title}</Heading>
        <div className="ds-release__intro">
          <CoachReplyText text={note.intro} />
        </div>
        {note.image ? (
          <figure className="ds-release__shot">
            {/* A screenshot the team adds to apps/web/public/nouveautes/, shown as it is. */}
            <img src={`/nouveautes/${note.image.file}`} alt={note.image.alt} loading="lazy" />
          </figure>
        ) : null}
        {note.changes.length > 0 ? (
          <ul className="ds-release__changes">
            {note.changes.map((change, index) => (
              <li key={index}>
                <Pill tone={CHANGE_TONE[change.kind]}>{t(`nouveautes.changes.${change.kind}`)}</Pill>
                <div>
                  <CoachReplyText text={change.text} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
