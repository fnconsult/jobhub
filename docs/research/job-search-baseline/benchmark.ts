/* eslint-disable @typescript-eslint/no-explicit-any -- throwaway script reading raw provider JSON */
/**
 * Throwaway benchmark for #97 (Job Search baseline). Not production code.
 *
 * Drives today's Job discovery (`createJobDiscovery`, real Perplexity search, real
 * polite fetch, real JSON-LD / LLM extraction) for each case of dataset.json,
 * without the queue or the database: Job Offers go to an in-memory store that
 * deduplicates exactly like apps/web/src/job-offers (URL key + content fingerprint).
 * Each offer is then scored with `scoreMatch` against the case's Master CV.
 *
 *   npx tsx docs/research/job-search-baseline/benchmark.ts <path/to/.env> [caseId ...]
 *
 * Writes results/<caseId>.json. Secrets are read from the env file and never printed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createAiLayerFromEnv, buildSearchQuery, type AiLayer, type UsageEntry } from "@jobhub/ai";
import { scoreMatch, type CvContent, type JobOffer, type JobOfferDetails, type SearchCriteria } from "@jobhub/shared";
import { createJobDiscovery, type JobOfferStore } from "../../../apps/worker/src/job-discovery/index";
import { htmlToText, jsonLdBlocks } from "../../../packages/shared/src/page-reading/html";

// Prices (USD per 1M tokens / per call), looked up 2026-10-12. See README "Cost".
const PRICES = {
  perplexity: { input: 0.2, output: 1.2, perSearchCall: 0.0025 }, // Agent API preset "fast" (openai/gpt-5.6-luna) + web_search tool
  mistral: { input: 0.5, output: 1.5 }, // Mistral Large (mistral-large-latest), offer_analysis
};
const EUR_PER_USD = 0.86; // assumption, see README

interface Case {
  id: string;
  persona: string;
  criteria: SearchCriteria;
  cv: CvContent;
}

const here = new URL(".", import.meta.url);
const [envPath, ...only] = process.argv.slice(2);
if (!envPath) throw new Error("usage: benchmark.ts <env file> [caseId ...]");

function readEnv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = { ...readEnv(envPath), NODE_ENV: "development" };

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

// ---------- posting date / expiry from the page ----------
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
  let method = datePosted ? "json-ld datePosted" : undefined;
  if (!datePosted) {
    const meta = html.match(/(?:article:published_time|datePublished)["']?\s*(?:content=|:)\s*["']([0-9]{4}-[0-9]{2}-[0-9]{2}[^"']*)["']/i);
    if (meta) [datePosted, method] = [meta[1], "meta published_time"];
  }
  const text = htmlToText(html).slice(0, 60_000);
  if (!datePosted) {
    const rel = text.match(/(?:il y a|publiée? il y a)\s+(\d+)\s+(jours?|mois|semaines?)|posted\s+(\d+)\s+(days?|months?|weeks?)\s+ago/i);
    if (rel) {
      const n = Number(rel[1] ?? rel[3]);
      const unit = (rel[2] ?? rel[4] ?? "").toLowerCase();
      const days = unit.startsWith("mo") ? n * 30 : unit.startsWith("se") || unit.startsWith("we") ? n * 7 : n;
      datePosted = new Date(now.getTime() - days * 86_400_000).toISOString();
      method = "relative text";
    }
  }
  if (!datePosted) {
    const abs = text.match(/publi[ée]e?\s+le\s+(\d{1,2})[/.](\d{1,2})[/.](\d{4})/i);
    if (abs) [datePosted, method] = [`${abs[3]}-${abs[2]!.padStart(2, "0")}-${abs[1]!.padStart(2, "0")}`, "text dd/mm/yyyy"];
  }
  if (!datePosted) {
    const abs = text.match(/publi[ée]e?\s+le\s+(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
    const month = abs ? MONTHS[abs[2]!.toLowerCase()] : undefined;
    if (abs && month !== undefined) [datePosted, method] = [`${abs[3]}-${String(month + 1).padStart(2, "0")}-${abs[1]!.padStart(2, "0")}`, "text d month yyyy"];
  }
  const posted = datePosted ? Date.parse(datePosted) : NaN;
  const ageDays = Number.isNaN(posted) ? null : Math.round((now.getTime() - posted) / 86_400_000);
  const until = validThrough ? Date.parse(validThrough) : NaN;
  const expiredMarker = /offre (?:n'est plus (?:disponible|en ligne|active)|expir[ée]e|pourvue|cl[ôo]tur[ée]e)|no longer (?:available|accepting applications)|this job (?:has expired|is closed)/i.test(text);
  const reasons: string[] = [];
  if (!Number.isNaN(until) && until < now.getTime()) reasons.push("validThrough passed");
  if (expiredMarker) reasons.push("expiry wording on page");
  if (ageDays !== null && ageDays > 60) reasons.push("posted >60 days ago");
  return { datePosted: datePosted ?? null, dateMethod: method ?? null, validThrough: validThrough ?? null, ageDays, looksExpired: reasons.length > 0, expiryReasons: reasons };
}

// ---------- one case ----------
async function runCase(c: Case) {
  const now = new Date();
  const usage: UsageEntry[] = [];
  const fetches: { url: string; status: number | string; ms: number; kind: "ai" | "page" | "robots" }[] = [];
  const html = new Map<string, string>();
  const perplexityRaw: unknown[] = [];

  const timedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const kind = /api\.(perplexity|mistral)\.ai/.test(url) ? "ai" : /\/robots\.txt$/.test(url) ? "robots" : "page";
    const start = performance.now();
    try {
      const response = await fetch(input, init);
      fetches.push({ url, status: response.status, ms: Math.round(performance.now() - start), kind });
      if (kind === "page" && (response.headers.get("content-type") ?? "").includes("html")) {
        response.clone().text().then((body) => html.set(url, body), () => {});
      }
      if (url.includes("api.perplexity.ai")) {
        response.clone().json().then((body: any) => {
          perplexityRaw.push({
            model: body?.model,
            usage: body?.usage,
            searchResults: (body?.output ?? []).filter((o: any) => o.type === "search_results").flatMap((o: any) => (o.results ?? []).map((r: any) => ({ url: r.url, title: r.title, date: r.date ?? r.last_updated ?? null }))),
            answer: (body?.output ?? []).filter((o: any) => o.type === "message").flatMap((o: any) => (o.content ?? []).map((p: any) => p.text ?? "")).join(""),
          });
        }, () => {});
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
  const ai: AiLayer = {
    ...base,
    async searchWeb(request) {
      const start = performance.now();
      const result = await base.searchWeb(request);
      timing.searchMs = Math.round(performance.now() - start);
      sources = result.sources;
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
  const discovery = createJobDiscovery({ ai, jobOffers: store, fetch: timedFetch });
  const start = performance.now();
  let report;
  let error: string | null = null;
  try {
    report = await discovery.discover({ candidateId: `bench-${c.id}`, criteria: c.criteria });
  } catch (e) {
    error = (e as Error).message;
  }
  const totalMs = Math.round(performance.now() - start);
  await new Promise((r) => setTimeout(r, 200)); // let clone().text() settle

  const offers = (report?.jobOffers ?? []).map((offer) => {
    const page = (offer.source.url && html.get(offer.source.url)) || "";
    const { score, breakdown } = scoreMatch({ cv: c.cv, jobOffer: offer as JobOfferDetails, searchCriteria: c.criteria, today: now });
    return {
      url: offer.source.url,
      title: offer.title,
      employer: offer.employer ?? null,
      location: offer.location ?? null,
      contractType: offer.contractType ?? null,
      remoteWork: offer.remoteWork ?? null,
      salary: offer.salary ?? null,
      skills: offer.skills ?? null,
      requiredExperienceYears: offer.requiredExperienceYears ?? null,
      readBy: page && /JobPosting/i.test(page) ? "json-ld" : "llm",
      matchScore: score,
      breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, v.status])),
      ...postingDates(page, now),
      contentExcerpt: offer.content.slice(0, 700),
    };
  });

  const perplexity = usage.filter((u) => u.provider === "perplexity");
  const mistral = usage.filter((u) => u.provider === "mistral");
  const sum = (list: UsageEntry[], key: "inputTokens" | "outputTokens") => list.reduce((n, u) => n + u[key], 0);
  // Perplexity bills each response and reports it (usage.cost.total_cost); fall back to list prices if absent.
  const billed = perplexityRaw.map((raw: any) => raw?.usage?.cost?.total_cost).filter((n): n is number => typeof n === "number");
  const perplexityUsd =
    billed.length === perplexity.length && billed.length > 0
      ? billed.reduce((a, b) => a + b, 0)
      : perplexity.length * PRICES.perplexity.perSearchCall +
        (sum(perplexity, "inputTokens") * PRICES.perplexity.input + sum(perplexity, "outputTokens") * PRICES.perplexity.output) / 1e6;
  const mistralUsd = (sum(mistral, "inputTokens") * PRICES.mistral.input + sum(mistral, "outputTokens") * PRICES.mistral.output) / 1e6;
  const usd = perplexityUsd + mistralUsd;

  const pageFetches = fetches.filter((f) => f.kind !== "ai");
  return {
    id: c.id,
    persona: c.persona,
    criteria: c.criteria,
    query: buildSearchQuery(c.criteria),
    ranAt: now.toISOString(),
    error,
    funnel: {
      providerUrls: sources.length,
      considered: Math.min(sources.length, 10),
      refusedBeforeRead: (report?.skipped ?? []).filter((s) => !["not_a_job_offer", "invalid"].includes(s.reason)).length,
      readButNotAnOffer: (report?.skipped ?? []).filter((s) => s.reason === "not_a_job_offer").length,
      invalid: (report?.skipped ?? []).filter((s) => s.reason === "invalid").length,
      captured: stats.captures,
      duplicatesMerged: stats.duplicates,
      offersAfterDedup: offers.length,
      score60plus: offers.filter((o) => o.matchScore >= 60).length,
      fresh30d: offers.filter((o) => o.ageDays !== null && o.ageDays < 30).length,
      unknownAge: offers.filter((o) => o.ageDays === null).length,
      looksExpired: offers.filter((o) => o.looksExpired).length,
    },
    timing: {
      totalMs,
      searchMs: timing.searchMs,
      pageFetchMsSum: pageFetches.reduce((n, f) => n + f.ms, 0),
      pageRequests: pageFetches.length,
      extractionMs: timing.extractionMs,
      extractionCalls: timing.extractionCalls,
    },
    tokens: {
      perplexity: { calls: perplexity.length, input: sum(perplexity, "inputTokens"), output: sum(perplexity, "outputTokens"), model: perplexity[0]?.model ?? null },
      mistral: { calls: mistral.length, input: sum(mistral, "inputTokens"), output: sum(mistral, "outputTokens"), model: mistral[0]?.model ?? null },
      perplexityUsd: Number(perplexityUsd.toFixed(5)),
      perplexityUsdSource: billed.length ? "billed (response usage.cost)" : "list price",
      mistralUsd: Number(mistralUsd.toFixed(5)),
      estimatedUsd: Number(usd.toFixed(5)),
      estimatedEur: Number((usd * EUR_PER_USD).toFixed(5)),
    },
    sources,
    skipped: report?.skipped ?? [],
    fetches: pageFetches,
    perplexityRaw,
    offers,
  };
}

const cases: Case[] = JSON.parse(readFileSync(new URL("dataset.json", here), "utf8"));
mkdirSync(new URL("results/", here), { recursive: true });
for (const c of cases.filter((c) => only.length === 0 || only.includes(c.id))) {
  const result = await runCase(c);
  writeFileSync(new URL(`results/${c.id}.json`, here), JSON.stringify(result, null, 2) + "\n");
  const f = result.funnel;
  console.log(
    `${c.id}: urls=${f.providerUrls} considered=${f.considered} refused=${f.refusedBeforeRead} notOffer=${f.readButNotAnOffer} offers=${f.offersAfterDedup} ≥60=${f.score60plus} fresh=${f.fresh30d} ` +
      `time=${(result.timing.totalMs / 1000).toFixed(1)}s €${result.tokens.estimatedEur}${result.error ? ` ERROR ${result.error}` : ""}`,
  );
}
