/**
 * Search provider benchmark for #111: the #97 baseline run again with another web search provider.
 * Throwaway research script, not production code.
 *
 * Drives today's Job discovery (`createJobDiscovery`: real web search, real polite fetch,
 * real JSON-LD / LLM extraction) for each case of dataset.json, with
 * AI_WEB_SEARCH_PROVIDER set to the provider under test. No queue and no database: Job Offers go
 * to an in-memory store that deduplicates like apps/web/src/job-offers. Unlike the baseline,
 * every URL the provider returns is looked at (no 10-page cap), so providers returning 20
 * results are judged on all of them.
 *
 *   npx tsx docs/research/job-search-providers/benchmark.ts <path/to/.env> <provider[:model]> [caseId ...]
 *   e.g. … .env brave       … .env tavily       … .env tavily:advanced       … .env linkup
 *
 * The env file needs the provider's key (BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, LINKUP_API_KEY)
 * and an offer_analysis route (the baseline used Mistral). Secrets are never printed.
 * Writes results/<provider[-model]>/<caseId>.json; then run summarize.ts.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildSearchQuery, costInEur, createAiLayerFromEnv, type AiLayer, type UsageEntry } from "@jobhub/ai";
import { scoreMatch, type CvContent, type JobOffer, type JobOfferDetails, type SearchCriteria } from "@jobhub/shared";
import { createJobDiscovery, type JobOfferStore } from "../../../apps/worker/src/job-discovery/index";
import { htmlToText, jsonLdBlocks } from "../../../apps/worker/src/job-discovery/html";

interface Case {
  id: string;
  persona: string;
  criteria: SearchCriteria;
  cv: CvContent;
}

const here = new URL(".", import.meta.url);
const [envPath, providerArg, ...only] = process.argv.slice(2);
if (!envPath || !providerArg) throw new Error("usage: benchmark.ts <env file> <provider[:model]> [caseId ...]");
const [provider, model = ""] = providerArg.split(":");
const runName = model ? `${provider}-${model}` : provider!;

function readEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = { ...readEnv(envPath), NODE_ENV: "development", AI_FAKE: "false", AI_WEB_SEARCH_PROVIDER: provider!, AI_WEB_SEARCH_MODEL: model };

// ---------- in-memory Job Offer store, same dedup keys as apps/web/src/job-offers ----------
const TRACKING = /^(utm_.*|fbclid|gclid|msclkid|mc_[a-z]+|ref|refid|trk|trackingid|origin|from|src|source)$/i;
function urlKey(url: string): string {
  const parsed = new URL(url);
  const params = [...parsed.searchParams].filter(([name]) => !TRACKING.test(name)).sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`;
}
const fingerprint = (content: string) =>
  createHash("sha256").update(content.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()).digest("hex");

function memoryStore() {
  const offers: JobOffer[] = [];
  const byUrl = new Map<string, JobOffer>();
  const byText = new Map<string, JobOffer>();
  const stats = { captures: 0, duplicates: 0 };
  const store: JobOfferStore = {
    async findBySourceUrl(url) {
      return URL.canParse(url) ? (byUrl.get(urlKey(url)) ?? null) : null;
    },
    async capture(input) {
      stats.captures++;
      if (!input.title?.trim() || !input.content?.trim()) return { ok: false, errors: ["title/content empty"] };
      const key = input.source.url ? urlKey(input.source.url) : null;
      const text = fingerprint(input.content);
      const existing = (key && byUrl.get(key)) || byText.get(text);
      if (existing) {
        stats.duplicates++;
        return { ok: true, jobOffer: existing };
      }
      const { source, ...details } = input;
      const offer: JobOffer = { id: `offer-${offers.length + 1}`, source: { url: source.url, name: new URL(source.url).hostname }, ...details };
      offers.push(offer);
      if (key) byUrl.set(key, offer);
      byText.set(text, offer);
      return { ok: true, jobOffer: offer };
    },
  };
  return { store, stats };
}

// ---------- posting date / expiry from the page (as in the baseline) ----------
const MONTHS: Record<string, number> = {
  janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, décembre: 11,
};
function postingDates(html: string, now: Date) {
  let datePosted: string | undefined;
  let validThrough: string | undefined;
  const scan = (node: unknown, depth = 0): void => {
    if (depth > 6 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => scan(n, depth + 1));
    const obj = node as Record<string, unknown>;
    if (typeof obj.datePosted === "string") datePosted ??= obj.datePosted;
    if (typeof obj.validThrough === "string") validThrough ??= obj.validThrough;
    if (obj["@graph"]) scan(obj["@graph"], depth + 1);
  };
  for (const block of jsonLdBlocks(html)) {
    try {
      scan(JSON.parse(block.trim()));
    } catch {
      /* ignore */
    }
  }
  if (!datePosted) datePosted = html.match(/(?:article:published_time|datePublished)["']?\s*(?:content=|:)\s*["']([0-9]{4}-[0-9]{2}-[0-9]{2}[^"']*)["']/i)?.[1];
  const text = htmlToText(html).slice(0, 60_000);
  if (!datePosted) {
    const rel = text.match(/(?:il y a|publiée? il y a)\s+(\d+)\s+(jours?|mois|semaines?)|posted\s+(\d+)\s+(days?|months?|weeks?)\s+ago/i);
    if (rel) {
      const n = Number(rel[1] ?? rel[3]);
      const unit = (rel[2] ?? rel[4] ?? "").toLowerCase();
      const days = unit.startsWith("mo") ? n * 30 : unit.startsWith("se") || unit.startsWith("we") ? n * 7 : n;
      datePosted = new Date(now.getTime() - days * 86_400_000).toISOString();
    }
  }
  if (!datePosted) {
    const abs = text.match(/publi[ée]e?\s+le\s+(\d{1,2})[/.](\d{1,2})[/.](\d{4})/i);
    if (abs) datePosted = `${abs[3]}-${abs[2]!.padStart(2, "0")}-${abs[1]!.padStart(2, "0")}`;
  }
  if (!datePosted) {
    const abs = text.match(/publi[ée]e?\s+le\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
    const month = abs ? MONTHS[abs[2]!.toLowerCase()] : undefined;
    if (abs && month !== undefined) datePosted = `${abs[3]}-${String(month + 1).padStart(2, "0")}-${abs[1]!.padStart(2, "0")}`;
  }
  const posted = datePosted ? Date.parse(datePosted) : NaN;
  const ageDays = Number.isNaN(posted) ? null : Math.round((now.getTime() - posted) / 86_400_000);
  const until = validThrough ? Date.parse(validThrough) : NaN;
  const expiredMarker = /offre (?:n'est plus (?:disponible|en ligne|active)|expir[ée]e|pourvue|cl[ôo]tur[ée]e)|no longer (?:available|accepting applications)|this job (?:has expired|is closed)/i.test(text);
  const looksExpired = (!Number.isNaN(until) && until < now.getTime()) || expiredMarker || (ageDays !== null && ageDays > 60);
  return { datePosted: datePosted ?? null, ageDays, looksExpired };
}

// ---------- one case ----------
async function runCase(c: Case) {
  const now = new Date();
  const usage: UsageEntry[] = [];
  const fetches: { url: string; status: number | string; ms: number; kind: "page" | "robots" }[] = [];
  const html = new Map<string, string>();
  const isAi = (url: string) => /api\.(perplexity\.ai|mistral\.ai|search\.brave\.com|tavily\.com|linkup\.so)|bedrock|aiplatform|anthropic|openai/.test(url);

  const timedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (isAi(url)) return fetch(input, init);
    const kind = /\/robots\.txt$/.test(url) ? "robots" : "page";
    const start = performance.now();
    try {
      const response = await fetch(input, init);
      fetches.push({ url, status: response.status, ms: Math.round(performance.now() - start), kind });
      if (kind === "page" && (response.headers.get("content-type") ?? "").includes("html")) {
        response.clone().text().then((body) => html.set(url, body), () => {});
      }
      return response;
    } catch (error) {
      fetches.push({ url, status: `error: ${(error as Error).name}`, ms: Math.round(performance.now() - start), kind });
      throw error;
    }
  };

  const base = createAiLayerFromEnv(env, { fetch: timedFetch, usage: { record: (entry) => void usage.push(entry) } });
  const timing = { searchMs: 0, extractionMs: 0, extractionCalls: 0 };
  let sources: string[] = [];
  let answer = "";
  let searchEur = 0;
  let searchModel = "";
  const ai: AiLayer = {
    ...base,
    async searchWeb(request) {
      const start = performance.now();
      const result = await base.searchWeb(request);
      timing.searchMs = Math.round(performance.now() - start);
      sources = result.sources;
      answer = result.answer;
      searchEur = costInEur(result);
      searchModel = result.model;
      return result;
    },
    async generate(request) {
      const start = performance.now();
      try {
        return await base.generate(request);
      } finally {
        timing.extractionMs += Math.round(performance.now() - start);
        timing.extractionCalls++;
      }
    },
  };

  const { store, stats } = memoryStore();
  const discovery = createJobDiscovery({ ai, jobOffers: store, fetch: timedFetch, maxPages: Number.POSITIVE_INFINITY });
  const start = performance.now();
  let report;
  let error: string | null = null;
  try {
    report = await discovery.discover({ candidateId: `bench-${c.id}`, criteria: c.criteria });
  } catch (e) {
    error = (e as Error).message;
    report = (e as { partial?: typeof report }).partial;
  }
  const totalMs = Math.round(performance.now() - start);
  await new Promise((r) => setTimeout(r, 200)); // let clone().text() settle

  const offers = (report?.jobOffers ?? []).map((offer) => {
    const page = (offer.source.url && html.get(offer.source.url)) || "";
    const { score } = scoreMatch({ cv: c.cv, jobOffer: offer as JobOfferDetails, searchCriteria: c.criteria, today: now });
    return {
      url: offer.source.url,
      title: offer.title,
      employer: offer.employer ?? null,
      location: offer.location ?? null,
      matchScore: score,
      ...postingDates(page, now),
      contentExcerpt: offer.content.slice(0, 500),
    };
  });
  const skipped = report?.skipped ?? [];
  const costEur = report?.costEur ?? searchEur;

  return {
    id: c.id,
    provider: runName,
    searchModel,
    criteria: c.criteria,
    query: buildSearchQuery(c.criteria),
    ranAt: now.toISOString(),
    error,
    funnel: {
      providerUrls: sources.length,
      refusedBeforeRead: skipped.filter((s) => !["not_a_job_offer", "invalid"].includes(s.reason)).length,
      readButNotAnOffer: skipped.filter((s) => s.reason === "not_a_job_offer").length,
      invalid: skipped.filter((s) => s.reason === "invalid").length,
      captured: stats.captures,
      duplicatesMerged: stats.duplicates,
      offersAfterDedup: offers.length,
      score60plus: offers.filter((o) => o.matchScore >= 60).length,
      fresh30d: offers.filter((o) => o.ageDays !== null && o.ageDays < 30).length,
      looksExpired: offers.filter((o) => o.looksExpired).length,
    },
    timing: {
      totalMs,
      searchMs: timing.searchMs,
      pageFetchMsSum: fetches.reduce((n, f) => n + f.ms, 0),
      pageRequests: fetches.length,
      extractionMs: timing.extractionMs,
      extractionCalls: timing.extractionCalls,
    },
    cost: { searchEur: Number(searchEur.toFixed(5)), costEur: Number(costEur.toFixed(5)), source: "list prices (packages/ai/src/cost.ts)" },
    usage: usage.map(({ provider, model, task, inputTokens, outputTokens }) => ({ provider, model, task, inputTokens, outputTokens })),
    sources,
    answer,
    skipped,
    fetches,
    offers,
  };
}

createAiLayerFromEnv(env, { usage: { record() {} } }); // fails now, before any output, on a missing key or a bad routing
const cases: Case[] = JSON.parse(readFileSync(new URL("dataset.json", here), "utf8"));
const out = new URL(`results/${runName}/`, here);
mkdirSync(out, { recursive: true });
for (const c of cases.filter((c) => only.length === 0 || only.includes(c.id))) {
  const result = await runCase(c);
  writeFileSync(new URL(`${c.id}.json`, out), JSON.stringify(result, null, 2) + "\n");
  const f = result.funnel;
  console.log(
    `${runName} ${c.id}: urls=${f.providerUrls} refused=${f.refusedBeforeRead} notOffer=${f.readButNotAnOffer} offers=${f.offersAfterDedup} ≥60=${f.score60plus} fresh=${f.fresh30d} ` +
      `time=${(result.timing.totalMs / 1000).toFixed(1)}s search €${result.cost.searchEur} total €${result.cost.costEur}${result.error ? ` ERROR ${result.error}` : ""}`,
  );
}
