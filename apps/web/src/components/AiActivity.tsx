"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDuration, formatTimeOfDay, formatTokens, PROVENANCE_GLYPHS, spokenMeasure, type Activity, type ProvenanceSite } from "@jobhub/shared";
import { isRunning, liveView, type LiveAction, type LiveStep, type LiveView } from "@/ai-activity/live";
import { activityElement, aiActivityPane, byRulesOnly, type ActivityElement, type ActivityModel, type ActivityTool, type AiActivityPane } from "@/ai-activity/pane";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { useAiActivityLive } from "@/components/AiActivityLive";
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
  /** The Candidate's AI actions running, or stopped or failed lately: this page's, and those « En cours ailleurs » (#333). */
  live: LiveView;
  /** Stops a running action. */
  stop: (key: string) => void;
};

const NO_ACTIONS: readonly LiveAction[] = [];

const AiActivityControl = createContext<Control | null>(null);

/**
 * AI Activity (CONTEXT.md, #314, #332): the Candidate's top-bar button, left of « Aide et coach », and the « Cette page »
 * pane it opens, of the page's `elements` (one loader per page type, ai-activity/index.ts) and of the AI Coach replies
 * given here about the page's object since it loaded; and, live, the Candidate's AI actions as they run, here or « En cours
 * ailleurs » (AiActivityLive, #333). Candidate pages only: the Back Office mounts no provider, so neither the button nor the
 * pane renders there.
 */
export function AiActivityProvider({ elements, children }: { elements: readonly ActivityElement[]; children: ReactNode }) {
  const given = useCoachRepliesInView();
  const store = useAiActivityLive();
  const pathname = usePathname();
  const actions = store?.actions ?? NO_ACTIONS;
  const live = useMemo(() => liveView(actions, pathname), [actions, pathname]);
  const stopAction = store?.stop;
  const stop = useCallback((key: string) => stopAction?.(key), [stopAction]);
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
  const control: Control = { pane, open, paneId: `${paneId}-pane`, toggle: () => (open ? close() : setOpen(true)), close, button, live, stop };
  return (
    <AiActivityControl.Provider value={control}>
      {children}
    </AiActivityControl.Provider>
  );
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
 * The button: in its frame, at rest the tasks icon, or while an action runs its live Activity glyph (#333); open, a
 * close icon. Closed, its words sit left of the frame, outside the button (#369): the page's summary, or the step under
 * way with its stop icon beside them, between the words and the frame; none on a page with no AI. The words are not a
 * control of their own: clicking them opens the pane, and the button's name says them (aria-labelledby), one tab stop.
 * Its label « Activité IA » is never shown, only its name for screen readers and its tooltip. On a phone, the frame
 * alone. Renders nothing outside AiActivityProvider.
 */
export function AiActivityButton() {
  const { t } = useTranslation();
  const control = useContext(AiActivityControl);
  const summary = useSummary(control?.pane.summary ?? null);
  const labelId = useId();
  const wordsId = useId();
  if (!control) return null;
  const { open, paneId, toggle, close, button } = control;
  const underWay = open ? null : control.live.underWay;
  const words = open ? null : underWay ? <StepWords action={underWay} /> : summary;
  const icon = open ? <Icons.close /> : underWay ? <ActivityGlyph activity={underWay.current?.activity ?? BEFORE_FIRST_STEP} live /> : <Icons.aiActivity />;
  return (
    <span className="ai-activity-control">
      {words !== null ? (
        <span id={wordsId} className="ai-activity-summary" onClick={toggle}>
          {words}
        </span>
      ) : null}
      {underWay ? <StopButton action={underWay} stop={control.stop} /> : null}
      <button
        ref={button}
        className="ai-activity-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={paneId}
        // Its name, with the words: « Activité IA 3 modèles · … ».
        aria-labelledby={words !== null ? `${labelId} ${wordsId}` : undefined}
        title={t("aiActivity.label")}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) close();
        }}
      >
        <span id={labelId} className="ai-activity-label">
          {t("aiActivity.label")}
        </span>
        <span className="ai-activity-frame">{icon}</span>
      </button>
    </span>
  );
}

/** The glyph before an action's first step. */
const BEFORE_FIRST_STEP: Activity = "think";

/** What an action under way is doing, in words: its step, « Arrêt en cours… », or « Démarrage » before its first step. */
function StepWords({ action }: { action: LiveAction }) {
  const { t } = useTranslation();
  if (action.status === "stopping") return t("aiActivity.live.stopping");
  return action.current ? t(`aiActivity.steps.${action.current.label}`) : t("aiActivity.live.starting");
}

/** The stop icon of a running action: icon only, named by its aria-label and its tooltip; disabled once the Stop is asked. */
function StopButton({ action, stop }: { action: LiveAction; stop: (key: string) => void }) {
  const { t } = useTranslation();
  const name = t(`aiActivity.live.stop.${action.kind}`);
  return (
    <button className="button ai-activity-stop" type="button" aria-label={name} title={name} disabled={action.status === "stopping"} onClick={() => stop(action.key)}>
      <Icons.stop />
    </button>
  );
}

/** Now, every second while an action runs: its time so far. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** The ended steps shown under a running action: the latest; the earlier ones are counted. */
const ENDED_STEPS_SHOWN = 4;

/**
 * A live action in the pane (#333): its kind (and its Profile), its status in words (its time so far; done, « ✓ Dernière
 * recherche · 16 s », its wall-clock time; or when it stopped or failed, during which step and why, in light red), its
 * tokens and time, its steps (each with its glyph, its result, the model or Tool that served, tokens · time and its hour)
 * and, while it runs, its stop icon. « En cours ailleurs », a link to its page.
 */
function LiveSection({ action, elsewhere, stop, now }: { action: LiveAction; elsewhere: boolean; stop: (key: string) => void; now: number }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const titleId = useId();
  const running = isRunning(action);
  const title = action.name ? `${t(`aiActivity.kinds.${action.kind}`)} · ${action.name}` : t(`aiActivity.kinds.${action.kind}`);
  const ended = action.steps.filter((step) => !step.running);
  const earlier = Math.max(0, ended.length - ENDED_STEPS_SHOWN);
  const shown = action.steps.filter((step) => step.running || ended.indexOf(step) >= earlier);
  const ms = (action.endedAt ? Date.parse(action.endedAt) : now) - Date.parse(action.startedAt);
  const at = action.endedAt ? formatTimeOfDay(new Date(action.endedAt), new Date(now), language) : "";
  const Heading = elsewhere ? "h4" : "h3";
  return (
    <article className="ai-activity-live" data-status={action.status} aria-labelledby={titleId}>
      <div className="ai-activity-row">
        <Heading id={titleId} className="ai-activity-live-title">
          {title}
        </Heading>
        {running ? <StopButton action={action} stop={stop} /> : null}
      </div>
      <p className="ai-activity-row ai-activity-live-status">
        <span>
          {action.status === "running" ? (
            t("aiActivity.live.running", { time: formatDuration(Math.max(0, ms), language) })
          ) : action.status === "done" ? (
            <>
              <Icons.done />{" "}
              {t(`aiActivity.live.done.${action.kind}`, { time: formatDuration(Math.max(0, ms), language) })}
            </>
          ) : action.status === "stopping"
              ? t("aiActivity.live.stopping")
              : action.status === "stopped"
                ? t("aiActivity.live.stopped", { time: at })
                : action.failure?.step
                  ? t("aiActivity.live.failedStep", { time: at, step: t(`aiActivity.steps.${action.failure.step}`) })
                  : t("aiActivity.live.failed", { time: at })}
        </span>
        {/* Done, its wall-clock time is in its words already. */}
        <Measure tokens={action.tokens} ms={running || action.status === "done" ? null : Math.max(0, ms)} withUnit />
      </p>
      {action.status === "failed" ? <p className="ai-activity-live-reason">{action.failure?.reason ? t(action.failure.reason as ParseKeys) : t("aiActivity.live.unknownReason")}</p> : null}
      {action.steps.length > 0 ? (
        <ol className="ai-activity-live-steps" aria-label={t("aiActivity.live.steps")}>
          {earlier > 0 ? <li className="ai-activity-meta">{t("aiActivity.live.earlierSteps", { count: earlier })}</li> : null}
          {shown.map((step) => (
            <li key={step.id} className="ai-activity-live-step" data-running={step.running || undefined}>
              <ActivityGlyph activity={step.activity} live={step.running && running} />
              <span className="ai-activity-live-step-words">
                {t(`aiActivity.steps.${step.label}`)}
                {step.model ?? step.tool ? <span className="ai-activity-meta"> · {step.model ?? step.tool}</span> : null}
                <StepResult step={step} />
              </span>
              <Measure tokens={step.tokens} ms={step.ms} />
              <time className="ai-activity-meta ai-activity-live-step-at" dateTime={step.at}>
                {formatTimeOfDay(new Date(step.at), new Date(now), language)}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
      {elsewhere ? (
        <Link className="ai-activity-live-link" href={action.href}>
          {t(`aiActivity.live.open.${action.kind}`)}
        </Link>
      ) : null}
    </article>
  );
}

/** What an ended step came to: stopped or failed, in words; otherwise its calls (« 12 pages lues »), and a warning if it had one. */
function StepResult({ step }: { step: LiveStep }) {
  const { t } = useTranslation();
  if (step.outcome === "stopped" || step.outcome === "failed") {
    return <span className="ai-activity-meta"> · {t(step.outcome === "stopped" ? "aiActivity.live.stepStopped" : "aiActivity.live.stepFailed")}</span>;
  }
  if (step.count === null) return null;
  return (
    <span className="ai-activity-meta">
      {" "}
      · {t(`aiActivity.live.result.${step.label}`, { count: step.count })}
      {step.outcome === "warning" ? ` · ${t("aiActivity.live.stepWarning")}` : null}
    </span>
  );
}

/** The live actions at the top of the pane: this page's, then those « En cours ailleurs ». */
function LiveSections({ live, stop }: { live: LiveView; stop: (key: string) => void }) {
  const { t } = useTranslation();
  const now = useNow([...live.here, ...live.elsewhere].some(isRunning));
  if (live.here.length === 0 && live.elsewhere.length === 0) return null;
  return (
    <>
      {live.here.map((action) => (
        <LiveSection key={action.key} action={action} elsewhere={false} stop={stop} now={now} />
      ))}
      {live.elsewhere.length > 0 ? (
        <section className="ai-activity-section ai-activity-elsewhere">
          <h3>{t("aiActivity.live.elsewhere")}</h3>
          {live.elsewhere.map((action) => (
            <LiveSection key={action.key} action={action} elsewhere stop={stop} now={now} />
          ))}
        </section>
      ) : null}
    </>
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
  const { pane, paneId, close, live, stop } = control;
  const anyLive = live.here.length > 0 || live.elsewhere.length > 0;
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
        <LiveSections live={live} stop={stop} />
        {pane.elements.length > 0 ? <PaneSections pane={pane} /> : anyLive ? null : <p className="ai-activity-empty">{t("aiActivity.noAi")}</p>}
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
            <li key={index} className="ai-activity-element" data-end={element.end.state === "done" ? undefined : element.end.state}>
              <div className="ai-activity-row">
                <strong>{labelOf(element)}</strong>
                {element.at ? (
                  <time className="ai-activity-meta" dateTime={element.at}>
                    {formatTimeOfDay(new Date(element.at), new Date(), language)}
                  </time>
                ) : null}
              </div>
              {element.name ? <p className="ai-activity-meta">{t(`aiActivity.kinds.${element.kind}`)}</p> : null}
              {element.end.state === "done" ? null : <EndWords end={element.end} />}
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
                <>
                  <p className="ai-activity-meta">{t("aiActivity.modelNotRecorded")}</p>
                  {/* What its own source names, though its model was not kept (#335: a Company Dossier built before). */}
                  {element.sites ? <Glyphs sites={element.sites} tools={[]} /> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/**
 * A stopped or failed element's end, in words, never by its light red alone (ADR-0009): « Arrêtée à 12:04 », « Échec à
 * 12:04 » (another day, « Arrêtée le 23/10 à 12:04 »), and a failed one's Failure Reason when known (#368).
 */
function EndWords({ end }: { end: Exclude<ActivityElement["end"], { state: "done" }> }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const at = end.at ? new Date(end.at) : null;
  // Another day: « Arrêtée le 23/10 à 12:04 ».
  const today = at !== null && at.toDateString() === new Date().toDateString();
  const words = at
    ? t(today ? `aiActivity.ended.${end.state}` : `aiActivity.ended.${end.state}On`, { time: formatTimeOfDay(at, new Date(), language) })
    : t(`aiActivity.ended.${end.state}Undated`);
  return (
    <>
      <p className="ai-activity-element-end">{words}</p>
      {end.state === "failed" && end.reason ? <p>{t(end.reason as ParseKeys)}</p> : null}
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
