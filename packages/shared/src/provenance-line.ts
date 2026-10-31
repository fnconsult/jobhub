/**
 * The Provenance line (#314, #327): what one piece of AI content shows of its Provenance on one quiet line, under
 * an AI Coach reply (and a Back Office Assistant reply), read from what was stored with it, never the configured route.
 *
 *   provenanceLine(provenance)          the models that served, tokens, time, Tools and Provenance sites
 *   formatTokens(2125, "fr")            « 2,1k »: the k stuck to the number from 1 000 on, no « tokens » word
 *   formatDuration(6400, "fr")          « 6,4 s », « 790 ms », « 1 min 05 s »
 *   formatTimeOfDay(at, now, "fr")      « 10:40 », « 22/10 à 10:15 » on another day (EN « 22 Oct, 10:15 »), the year in another year
 *   spokenMeasure(2100, 6400, "fr")     « 2 100 jetons, 6,4 secondes »: what screen readers hear for « 2,1k · 6,4 s »
 *
 * It names each model for people (the model catalogue), where it ran, and whether it went to the identity route
 * under the Candidate's EU AI Consent (« consentement IA UE ») or ran outside the EU (« hors UE »). It holds no cost,
 * prompt, AI task, Playbook Agent or id: a Provenance has none of the first ones, and the line leaves out its tasks.
 * No Provenance is « modèle non enregistré » (`recorded: false`).
 */
import { describeModel, residencyOf, whereItRan } from "./ai-models";
import type { Provenance, ProvenanceSite } from "./provenance";
import { markOf, type ProvenanceMark } from "./provenance-marks";
import type { Translated } from "./tools";

export interface ProvenanceLineModel {
  /** Its display name, e.g. « Claude Opus 5 »; an unknown model raw. */
  name: string;
  /** Where it ran, e.g. « AWS Bedrock · UE (Stockholm) »; null when the endpoint was not kept. */
  where: Translated | null;
  /** It went to the identity route under the Candidate's EU AI Consent: « consentement IA UE ». */
  euAiConsent: boolean;
  /** It ran outside the EU: « hors UE ». */
  outsideEu: boolean;
}

export interface ProvenanceLine {
  /** False: no Provenance was kept, « modèle non enregistré ». */
  recorded: boolean;
  /** Every model that served, each once, in the order they first did. */
  models: ProvenanceLineModel[];
  /** The tokens of all its AI steps, input and output; null when none were kept. */
  tokens: number | null;
  /** The wall-clock time, from start to end; null when it is not known (a reply saved before Provenance). */
  ms: number | null;
  /** The Tools it called, each once. */
  tools: ProvenanceMark[];
  /** The pages it was built from: sites on the web by their domain, the Candidate's own data (« Vos données »). */
  sites: ProvenanceSite[];
}

export function provenanceLine(provenance: Provenance | null): ProvenanceLine {
  if (!provenance) return { recorded: false, models: [], tokens: null, ms: null, tools: [], sites: [] };
  const models: ProvenanceLineModel[] = [];
  const tools: ProvenanceMark[] = [];
  let tokens: number | null = null;
  for (const step of provenance.steps) {
    if (step.kind === "tool") {
      const mark = markOf(step);
      if (mark.text && !tools.some((tool) => tool.text === mark.text)) tools.push(mark);
      continue;
    }
    if (step.kind !== "ai") continue;
    if (step.tokens) tokens = (tokens ?? 0) + step.tokens.input + step.tokens.output;
    if (!step.model) continue;
    const model: ProvenanceLineModel = {
      name: describeModel(step.model, step.provider).name,
      where: step.endpoint ? whereItRan(step.endpoint) : null,
      euAiConsent: step.euAiConsent === true,
      outsideEu: step.endpoint ? residencyOf(step.endpoint) === "outside_eu" : false,
    };
    if (!models.some((other) => other.name === model.name && other.euAiConsent === model.euAiConsent && other.where?.en === model.where?.en)) models.push(model);
  }
  return { recorded: true, models, tokens, ms: provenance.wallMs > 0 ? provenance.wallMs : null, tools, sites: provenance.sites };
}

type Language = keyof Translated;

const decimal = (value: number, language: Language) => new Intl.NumberFormat(language, { maximumFractionDigits: 1, useGrouping: false }).format(value);

/** Tokens as AI Activity writes them: « 850 », « 2,1k », « 125k ». */
export function formatTokens(tokens: number, language: Language): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : decimal(Math.round(thousands * 10) / 10, language)}k`;
}

/** A duration (#320): « 790 ms », « 6,4 s », « 1 min 05 s ». */
export function formatDuration(ms: number, language: Language): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${decimal(Math.round(seconds * 10) / 10, language)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, "0")} s`;
}

const unit = (value: number, name: "millisecond" | "second" | "minute", language: Language) =>
  new Intl.NumberFormat(language, { style: "unit", unit: name, unitDisplay: "long", maximumFractionDigits: 1 }).format(value);

/** A duration in words, for screen readers: « 790 millisecondes », « 6,4 secondes », « 1 minute 5 secondes ». */
function spokenDuration(ms: number, language: Language): string {
  if (ms < 1000) return unit(Math.round(ms), "millisecond", language);
  const seconds = ms / 1000;
  if (seconds < 60) return unit(Math.round(seconds * 10) / 10, "second", language);
  const whole = Math.round(seconds);
  return `${unit(Math.floor(whole / 60), "minute", language)} ${unit(whole % 60, "second", language)}`;
}

/** Tokens and time as screen readers hear them (#320): « 2 100 jetons, 6,4 secondes »; either may be unknown (null). */
export function spokenMeasure(tokens: number | null, ms: number | null, language: Language): string {
  return [tokens === null ? null : `${new Intl.NumberFormat(language).format(tokens)} ${language === "fr" ? "jetons" : "tokens"}`, ms === null ? null : spokenDuration(ms, language)]
    .filter((part) => part !== null)
    .join(", ");
}

/**
 * The time of day it happened, by Intl per language (#320): « 10:40 » today; « 22/10 à 10:15 » (EN « 22 Oct, 10:15 ») on
 * another day; « 22/10/2025 à 10:15 » (EN « 22 Oct 2025, 10:15 ») in another year.
 */
export function formatTimeOfDay(at: Date, now: Date, language: Language, options: { timeZone?: string } = {}): string {
  const zone = options.timeZone ? { timeZone: options.timeZone } : {};
  const locale = language === "fr" ? "fr-FR" : "en-GB";
  const part = (date: Date, format: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...format, ...zone }).format(date);
  const time = part(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = (date: Date) => part(date, { day: "2-digit", month: "2-digit", year: "numeric" });
  if (day(at) === day(now)) return time;
  const sameYear = part(at, { year: "numeric" }) === part(now, { year: "numeric" });
  if (language === "fr") return `${sameYear ? part(at, { day: "2-digit", month: "2-digit" }) : day(at)} à ${time}`;
  return `${part(at, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}, ${time}`;
}
