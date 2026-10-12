/**
 * Aggregates results/<provider>/*.json into results/summary.json, prints the README table and the verdict.
 * Run: npx tsx docs/research/job-search-providers/summarize.ts
 *
 * results/perplexity/ is the #97 baseline as it was recorded (its costs are in `tokens`); the
 * other providers' runs come from benchmark.ts (costs in `cost`). Both describe the same funnel.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { EUR_PER_USD } from "@jobhub/ai";
import { isSinglePosting, scoreProvider, verdict, type CaseRun, type ProviderScore } from "./pass-rule";

/** The providers #111 compares. Perplexity is the #97 baseline (Agent API, preset "fast"). */
const PROVIDERS = ["perplexity", "brave", "tavily", "linkup"] as const;

/* eslint-disable @typescript-eslint/no-explicit-any -- raw result JSON of two script generations */
const toCaseRun = (r: any): CaseRun => ({
  sources: r.sources,
  skipped: r.skipped,
  searchEur: r.cost?.searchEur ?? r.tokens.perplexityUsd * EUR_PER_USD,
  costEur: r.cost?.costEur ?? r.tokens.estimatedEur,
});

function load(provider: string): any[] | null {
  const dir = new URL(`./results/${provider}/`, import.meta.url);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^c\d+.*\.json$/.test(f)).sort();
  return files.length ? files.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8"))) : null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const scores: Record<string, ProviderScore | null> = {};
const rows: Record<string, unknown>[] = [];
for (const provider of PROVIDERS) {
  const runs = load(provider);
  scores[provider] = runs ? scoreProvider(runs.map(toCaseRun)) : null;
  if (!runs) continue;
  const sum = (key: string) => runs.reduce((n, r) => n + (r.funnel[key] ?? 0), 0);
  const score = scores[provider]!;
  rows.push({
    provider,
    cases: runs.length,
    providerUrls: score.providerUrls,
    singlePostings: score.singlePostings,
    readableSinglePostings: score.readableSinglePostings.length,
    refusedBeforeRead: sum("refusedBeforeRead"),
    readButNotAnOffer: sum("readButNotAnOffer"),
    offersAfterDedup: sum("offersAfterDedup"),
    score60plus: sum("score60plus"),
    fresh30d: sum("fresh30d"),
    medianSeconds: median(runs.map((r) => r.timing.totalMs)) / 1000,
    searchEur: score.searchEur,
    costEur: score.costEur,
    perSearchEur: score.perSearchEur,
    singlePostingUrls: runs.flatMap((r) => r.sources.filter(isSinglePosting)),
  });
}
const outcome = verdict(scores);
writeFileSync(new URL("./results/summary.json", import.meta.url), JSON.stringify({ outcome, rows }, null, 2) + "\n");

console.log("| Provider | Cases | URLs | Single postings | Readable single postings | Refused | Read, not an offer | Job Offers | ≥60 | <30 d | Median s | Search € | Total € | Readable single postings per search € |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const provider of PROVIDERS) {
  const r = rows.find((row) => row.provider === provider);
  if (!r) {
    console.log(`| ${provider} | not run | | | | | | | | | | | | |`);
    continue;
  }
  console.log(
    `| ${provider} | ${r.cases} | ${r.providerUrls} | ${r.singlePostings} | ${r.readableSinglePostings} | ${r.refusedBeforeRead} | ${r.readButNotAnOffer} | ${r.offersAfterDedup} | ${r.score60plus} | ${r.fresh30d} | ${(r.medianSeconds as number).toFixed(1)} | ${(r.searchEur as number).toFixed(4)} | ${(r.costEur as number).toFixed(4)} | ${r.perSearchEur} |`,
  );
}
console.log(`\nVerdict: ${JSON.stringify(outcome)}`);
