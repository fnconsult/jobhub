"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTimeOfDay, formatTokens, PROVENANCE_GLYPHS, spokenMeasure, type ProvenanceSite } from "@jobhub/shared";
import { activityElement, aiActivityPane, byRulesOnly, type ActivityElement, type ActivityModel, type ActivityTool, type AiActivityPane } from "@/ai-activity/pane";
import { useCoachRepliesInView } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";

type Language = "fr" | "en";

type Control = {
  pane: AiActivityPane;
  open: boolean;
  paneId: string;
  toggle: () => void;
  /** Closes the pane, focus back on the button. */
  close: () => void;
  button: React.RefObject<HTMLButtonElement | null>;
};

const AiActivityControl = createContext<Control | null>(null);

/**
 * AI Activity (CONTEXT.md, #314, #332): the Candidate's top-bar button, left of « Mon coach », and the « Cette page »
 * pane it opens, of the page's `elements` (one loader per page type, ai-activity/index.ts) and of the AI Coach replies
 * given here about the page's object since it loaded. Candidate pages only: the Back Office mounts no provider, so neither
 * the button nor the pane renders there.
 */
export function AiActivityProvider({ elements, children }: { elements: readonly ActivityElement[]; children: ReactNode }) {
  const given = useCoachRepliesInView();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const paneId = useId();
  const pane = useMemo(() => {
    // A reply given here is counted once, though the page loaded since also has it.
    const loaded = new Set(elements.filter((element) => element.kind === "coach_reply").map((element) => element.at));
    const added = given.map((reply) => activityElement("coach_reply", reply.provenance, { at: reply.at })).filter((element) => !loaded.has(element.at));
    return aiActivityPane([...elements, ...added]);
  }, [elements, given]);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  }, []);
  const control: Control = { pane, open, paneId: `${paneId}-pane`, toggle: () => (open ? close() : setOpen(true)), close, button };
  return <AiActivityControl.Provider value={control}>{children}</AiActivityControl.Provider>;
}

function useLanguage(): Language {
  const { i18n } = useTranslation();
  return i18n.language === "en" ? "en" : "fr";
}

/** « 3 modèles · 10,9k tokens · 21,5 s »: the closed button's words; null on a page with no recorded AI content. */
function useSummary(summary: AiActivityPane["summary"]): string | null {
  const { t } = useTranslation();
  const language = useLanguage();
  if (!summary) return null;
  return [
    t("aiActivity.models", { count: summary.models }),
    summary.tokens === null ? null : t("aiActivity.tokens", { tokens: formatTokens(summary.tokens, language) }),
    summary.ms === null ? null : formatDuration(summary.ms, language),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * The button: at rest the tasks icon and the page's summary, or its label « Activité IA » on a page with no AI (never an
 * icon alone, ADR-0009); open, its label and a close icon. On a phone, its short label. Renders nothing outside
 * AiActivityProvider.
 */
export function AiActivityButton() {
  const { t } = useTranslation();
  const control = useContext(AiActivityControl);
  const summary = useSummary(control?.pane.summary ?? null);
  if (!control) return null;
  const { open, paneId, toggle, close, button } = control;
  // The summary stands in for the label on screen only when it is shown: closed, and on a page with AI content.
  const summarised = !open && summary !== null;
  const className = open ? "button ai-activity-toggle ai-activity-toggle-open" : summarised ? "button ai-activity-toggle ai-activity-toggle-summarised" : "button ai-activity-toggle";
  return (
    <button
      ref={button}
      className={className}
      type="button"
      aria-expanded={open}
      aria-controls={paneId}
      title={t("aiActivity.label")}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) close();
      }}
    >
      {open ? <Icons.close /> : <Icons.aiActivity />}
      <span className="ai-activity-label">{t("aiActivity.label")}</span>
      {/* A space between them in the button's name: « Activité IA 3 modèles · … ». */}
      {summarised ? <span className="ai-activity-summary"> {summary}</span> : null}
    </button>
  );
}

/**
 * The « Cette page » pane: Modèles (with tokens · time and a Total), Sources, Outils and Par élément, each a section
 * that folds; or « Aucun contenu produit par l'IA sur cette page ». Beside the page from 64rem, a drawer over it while
 * the Coach Panel is docked below 81.25rem, a sheet on a phone (app.css). Escape closes it, focus back on the button.
 */
export function AiActivityPane() {
  const { t } = useTranslation();
  const control = useContext(AiActivityControl);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const open = control?.open ?? false;

  // Opened, the focus goes to its title, where the pane starts.
  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);

  // A fade at the bottom while there is more to scroll to.
  useEffect(() => {
    const scroller = body.current;
    if (!open || !scroller) return;
    const measure = () => setMore(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    scroller.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", measure);
    };
  }, [open]);

  if (!control || !open) return null;
  const { pane, paneId, close } = control;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    close();
  };

  return (
    <aside id={paneId} className="ai-activity-pane" aria-label={t("aiActivity.label")} data-more={more || undefined} onKeyDown={onKeyDown}>
      <div className="ai-activity-head">
        <h2 id={titleId} ref={title} tabIndex={-1}>
          {t("aiActivity.title")}
        </h2>
        <button className="button button-quiet" type="button" onClick={close}>
          <Icons.close />
          {t("aiActivity.close")}
        </button>
      </div>
      <div ref={body} className="ai-activity-body">
        {pane.elements.length === 0 ? <p className="ai-activity-empty">{t("aiActivity.noAi")}</p> : <PaneSections pane={pane} />}
      </div>
    </aside>
  );
}

function PaneSections({ pane }: { pane: AiActivityPane }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const labelOf = (element: ActivityElement) => element.name ?? t(`aiActivity.kinds.${element.kind}`);
  return (
    <>
      {pane.models.length > 0 ? (
        <Section
          title={t("aiActivity.sections.models")}
          aside={
            <span className="ai-activity-measure" title={t("aiActivity.measureHint")}>
              {t("aiActivity.measure")}
              <span className="visually-hidden"> ({t("aiActivity.measureHint")})</span>
            </span>
          }
        >
          <ul className="ai-activity-list">
            {pane.models.map((model) => (
              <li key={`${model.name}-${model.where?.en ?? ""}-${model.euAiConsent}`} className="ai-activity-row">
                <ModelName model={model} />
                <Measure tokens={model.tokens} ms={model.ms} />
              </li>
            ))}
            <li className="ai-activity-row ai-activity-total">
              <strong>{t("aiActivity.total")}</strong>
              <Measure tokens={pane.total.tokens} ms={pane.total.ms} withUnit />
            </li>
          </ul>
        </Section>
      ) : null}
      {pane.sites.length > 0 ? (
        <Section title={t("aiActivity.sections.sources")}>
          <ul className="ai-activity-list">
            {pane.sites.map((site) => (
              <li key={site.kind === "web" ? site.domain : "candidate"}>
                <SiteDisclosure site={site} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {pane.tools.length > 0 ? (
        <Section title={t("aiActivity.sections.tools")}>
          <ul className="ai-activity-list">
            {pane.tools.map((tool) => (
              <li key={tool.name ?? "rules"}>
                <div className="ai-activity-row">
                  <ToolName tool={tool} />
                  <Measure tokens={null} ms={tool.ms} />
                </div>
                <p className="ai-activity-meta">{t("aiActivity.usedBy", { elements: [...new Set(tool.usedBy.map((index) => labelOf(pane.elements[index]!)))].join(", ") })}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={t("aiActivity.sections.byElement")}>
        <ul className="ai-activity-list">
          {pane.elements.map((element, index) => (
            <li key={index} className="ai-activity-element">
              <div className="ai-activity-row">
                <strong>{labelOf(element)}</strong>
                {element.at ? (
                  <time className="ai-activity-meta" dateTime={element.at}>
                    {formatTimeOfDay(new Date(element.at), new Date(), language)}
                  </time>
                ) : null}
              </div>
              {element.name ? <p className="ai-activity-meta">{t(`aiActivity.kinds.${element.kind}`)}</p> : null}
              {element.served ? (
                <>
                  {element.served.models.map((model) => (
                    <p key={`${model.name}-${model.where?.en ?? ""}-${model.euAiConsent}`} className="ai-activity-element-model">
                      {model.name} {model.ids.map((id) => <code key={id}>{id}</code>)}
                    </p>
                  ))}
                  {/* Jobbbox's rules alone, no model (#336): « Calcul » where a model would be named. */}
                  {byRulesOnly(element.served) ? <p className="ai-activity-element-model">{t("aiActivity.steps.compute")}</p> : null}
                  <Glyphs sites={element.served.sites} tools={element.served.tools} />
                </>
              ) : (
                <p className="ai-activity-meta">{t("aiActivity.modelNotRecorded")}</p>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/** A section of the pane, folded and unfolded by its title, a disclosure button. */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="ai-activity-section">
      <div className="ai-activity-section-head">
        <h3>
          <button type="button" className="ai-activity-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)}>
            <Icons.chevron />
            {title}
          </button>
        </h3>
        {open ? aside : null}
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** A model for people, where it ran, and its route's chip; its raw id in the tooltip. */
function ModelName({ model }: { model: ActivityModel }) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <span className="ai-activity-model">
      <span title={model.ids.join(", ")}>{model.name}</span>
      {model.where ? <span className="ai-activity-meta">{model.where[language]}</span> : null}
      {model.euAiConsent || model.outsideEu ? (
        <span className="ai-activity-chips">
          {model.euAiConsent ? <span className="provenance-chip">{t("provenanceLine.euAiConsent")}</span> : null}
          {model.outsideEu ? <span className="provenance-chip">{t("provenanceLine.outsideEu")}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

/** A Tool by its logo (where its owner allowed it) and name, or « J » for Jobbbox's rules. */
function ToolName({ tool }: { tool: ActivityTool }) {
  const { t } = useTranslation();
  return (
    <span className="ai-activity-tool">
      {tool.logo ? (
        <img className="ai-activity-logo" src={tool.logo} alt="" />
      ) : tool.name === null ? (
        <span className="ai-activity-glyph" aria-hidden="true">
          {PROVENANCE_GLYPHS.rules}
        </span>
      ) : null}
      {tool.name ?? t("aiActivity.rules")}
    </span>
  );
}

/** « 2,1k · 6,4 s » to the eye, « 2 100 tokens, 6,4 secondes » to screen readers; the Total says « tokens ». */
function Measure({ tokens, ms, withUnit = false }: { tokens: number | null; ms: number | null; withUnit?: boolean }) {
  const { t } = useTranslation();
  const language = useLanguage();
  if (tokens === null && ms === null) return null;
  const shown = [
    tokens === null ? null : withUnit ? t("aiActivity.tokens", { tokens: formatTokens(tokens, language) }) : formatTokens(tokens, language),
    ms === null ? null : formatDuration(ms, language),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <span className="ai-activity-measure">
      <span aria-hidden="true">{shown}</span>
      <span className="visually-hidden">{spokenMeasure(tokens, ms, language)}</span>
    </span>
  );
}

/** A Provenance site: a disclosure button opening the pages read, each in a new tab without a referrer. */
function SiteDisclosure({ site }: { site: ProvenanceSite }) {
  const { t } = useTranslation();
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
            <a href={link} target="_blank" rel="noopener noreferrer">
              {site.kind === "web" ? link.replace(/^https?:\/\/(www\.)?/, "") : link}
              <span className="visually-hidden"> {t("aiActivity.newTab")}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

/** What an element was built from and with, as glyphs: 🌐 a site, 👤 the Candidate's data, a Tool's logo or name, « J » the rules. */
function Glyphs({ sites, tools }: { sites: ProvenanceSite[]; tools: ActivityTool[] }) {
  const { t } = useTranslation();
  if (sites.length === 0 && tools.length === 0) return null;
  return (
    <p className="ai-activity-glyphs">
      {sites.map((site) => {
        const name = site.kind === "web" ? site.domain : t("aiActivity.yourData");
        return (
          <span key={site.kind === "web" ? site.domain : "candidate"} className="ai-activity-glyph" title={name}>
            <span aria-hidden="true">{site.kind === "web" ? PROVENANCE_GLYPHS.site : PROVENANCE_GLYPHS.candidate}</span>
            <span className="visually-hidden">{name}</span>
          </span>
        );
      })}
      {tools.map((tool) =>
        tool.logo ? (
          <img key={tool.name} className="ai-activity-logo" src={tool.logo} alt={tool.name ?? ""} title={tool.name ?? undefined} />
        ) : (
          <span key={tool.name ?? "rules"} className="ai-activity-glyph" title={tool.name ?? t("aiActivity.rules")}>
            <span aria-hidden="true">{tool.name === null ? PROVENANCE_GLYPHS.rules : tool.name.charAt(0)}</span>
            <span className="visually-hidden">{tool.name ?? t("aiActivity.rules")}</span>
          </span>
        ),
      )}
    </p>
  );
}
