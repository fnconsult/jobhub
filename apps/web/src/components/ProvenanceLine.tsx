"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTimeOfDay, formatTokens, provenanceLine, type Provenance, type ProvenanceSite } from "@jobhub/shared";

type Language = "fr" | "en";

/**
 * The quiet line under an AI Coach or Back Office Assistant reply (#327, ADR-0009 amendment): the models that served it,
 * tokens · time, its Tools, its Provenance sites behind a disclosure button (a card on mouse hover) and its hour.
 * A reply with no Provenance says « modèle non enregistré ». Metadata: 0.8125rem in #6b6a67, never the only place
 * anything lives; screen readers hear the words the eye reads, the tokens named as such.
 */
export function ProvenanceLine({ provenance, at }: { provenance: Provenance | null; at: string }) {
  const { t, i18n } = useTranslation();
  const language: Language = i18n.language === "en" ? "en" : "fr";
  const line = provenanceLine(provenance);
  const sitesId = useId();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="provenance-line">
      {line.recorded ? null : <span>{t("provenanceLine.unrecorded")}</span>}
      {line.models.map((model) => (
        <span key={`${model.name}-${model.where?.en ?? ""}-${model.euAiConsent}`} className="provenance-line-model" title={model.where?.[language]}>
          {model.name}
          {model.where ? <span className="visually-hidden"> ({model.where[language]})</span> : null}
          {model.euAiConsent ? <span className="provenance-chip">{t("provenanceLine.euAiConsent")}</span> : null}
          {model.outsideEu ? <span className="provenance-chip">{t("provenanceLine.outsideEu")}</span> : null}
        </span>
      ))}
      {line.tokens !== null || line.ms !== null ? (
        <span title={t("provenanceLine.measure")}>
          {[
            line.tokens !== null ? (
              <span key="tokens">
                {formatTokens(line.tokens, language)}
                <span className="visually-hidden"> {t("provenanceLine.tokens")}</span>
              </span>
            ) : null,
            line.ms !== null ? <span key="time">{formatDuration(line.ms, language)}</span> : null,
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index === 0 ? [part] : [<span key={`dot-${index}`} aria-hidden="true">{" · "}</span>, part]))}
        </span>
      ) : null}
      {line.tools.map((tool) => (
        <span key={tool.text}>{tool.text}</span>
      ))}
      {line.sites.length > 0 ? (
        <div
          className={open ? "provenance-sites provenance-sites-open" : "provenance-sites"}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onKeyDown={closeOnEscape}
        >
          <button type="button" className="provenance-sites-button" aria-expanded={open} aria-controls={sitesId} onClick={() => setOpen((was) => !was)}>
            {t("provenanceLine.sources", { count: line.sites.length })}
          </button>
          <ul id={sitesId} className={open ? "provenance-sites-list" : "provenance-sites-list provenance-sites-card"} hidden={!open && !hovered}>
            {line.sites.map((site) => (
              <li key={site.kind === "web" ? site.domain : "candidate"}>
                <SiteLinks site={site} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <time dateTime={at}>{formatTimeOfDay(new Date(at), new Date(), language)}</time>
    </div>
  );
}

/** A Provenance site: its domain (or « Vos données ») and the pages read, each opened in a new tab without a referrer. */
function SiteLinks({ site }: { site: ProvenanceSite }) {
  const { t } = useTranslation();
  const name = site.kind === "web" ? site.domain : t("provenanceLine.yourData");
  if (site.links.length === 0) return <span>{name}</span>;
  return (
    <>
      <span>{name}</span>
      {site.links.map((link) => (
        <a key={link} href={link} target="_blank" rel="noreferrer">
          {site.kind === "web" ? link.replace(/^https?:\/\//, "") : link}
          <span className="visually-hidden"> {t("provenanceLine.newTab")}</span>
        </a>
      ))}
    </>
  );
}
