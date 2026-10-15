// Aggregates results/*.json (+ judgments.json) into results/summary.json and prints the README tables.
// Run: node docs/research/job-search-baseline/summarize.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("./results/", import.meta.url);
const judgments = JSON.parse(readFileSync(new URL("./judgments.json", import.meta.url), "utf8"));
const runs = readdirSync(dir)
  .filter((f) => /^c\d+.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));

/** A URL that points at one posting (vs a search / category / listing page), by known site patterns. */
const SINGLE_POSTING = /\/emplois\/\d+\.html|\/recherche\/detail\/\d+|\/jobs\/\d+$|detail_offre\?offreId=|\/offres-emploi\/\d+$|trabajo\.org\/offre-|roberthalf\.com\/.+-fh$/;
const kindOf = (url) => (SINGLE_POSTING.test(url) ? "single posting" : "listing / search page");

const totals = { providerUrls: 0, singlePostingUrls: 0, listingUrls: 0, refusedBeforeRead: 0, readButNotAnOffer: 0, invalid: 0, offersAfterDedup: 0, relevant: 0, score60plus: 0, fresh30d: 0, looksExpired: 0, ms: [], eur: [] };
const reasons = {};
const reasonByKind = {};
const rows = [];
for (const r of runs) {
  const single = r.sources.filter((u) => kindOf(u) === "single posting").length;
  totals.providerUrls += r.funnel.providerUrls;
  totals.singlePostingUrls += single;
  totals.listingUrls += r.sources.length - single;
  for (const key of ["refusedBeforeRead", "readButNotAnOffer", "invalid", "offersAfterDedup", "score60plus", "fresh30d", "looksExpired"]) totals[key] += r.funnel[key];
  for (const s of r.skipped) {
    reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
    const k = `${kindOf(s.url)} → ${s.reason}`;
    reasonByKind[k] = (reasonByKind[k] ?? 0) + 1;
  }
  const verdicts = r.offers.map((o) => judgments[o.url]?.verdict ?? "unjudged");
  totals.relevant += verdicts.filter((v) => v === "relevant").length;
  totals.ms.push(r.timing.totalMs);
  totals.eur.push(r.tokens.estimatedEur);
  rows.push({
    id: r.id,
    urls: r.funnel.providerUrls,
    single,
    refused: r.funnel.refusedBeforeRead,
    notOffer: r.funnel.readButNotAnOffer,
    offers: r.funnel.offersAfterDedup,
    scores: r.offers.map((o) => o.matchScore),
    s60: r.funnel.score60plus,
    relevant: verdicts.filter((v) => v === "relevant").length,
    partly: verdicts.filter((v) => v === "partly").length,
    fresh: r.funnel.fresh30d,
    expired: r.funnel.looksExpired,
    seconds: +(r.timing.totalMs / 1000).toFixed(1),
    searchS: +(r.timing.searchMs / 1000).toFixed(1),
    fetchS: +(r.timing.pageFetchMsSum / 1000).toFixed(1),
    extractS: +(r.timing.extractionMs / 1000).toFixed(1),
    llmCalls: r.timing.extractionCalls,
    pplxTokens: r.tokens.perplexity.input + r.tokens.perplexity.output,
    mistralTokens: r.tokens.mistral.input + r.tokens.mistral.output,
    eur: r.tokens.estimatedEur,
    pplxUsd: r.tokens.perplexityUsd,
    mistralUsd: r.tokens.mistralUsd,
  });
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const summary = {
  runs: runs.length,
  totals: { ...totals, ms: undefined, eur: undefined },
  skipReasons: reasons,
  skipReasonsByUrlKind: reasonByKind,
  timeSeconds: { median: median(totals.ms) / 1000, max: Math.max(...totals.ms) / 1000 },
  costEur: { median: median(totals.eur), max: Math.max(...totals.eur), total: +totals.eur.reduce((a, b) => a + b, 0).toFixed(4) },
  rows,
};
writeFileSync(new URL("summary.json", dir), JSON.stringify(summary, null, 2) + "\n");

console.log("| Case | URLs (single posting) | Refused | Read, not an offer | Offers | Match Scores | ≥60 | Relevant / partly | <30 d | Looks expired | Time s (search / fetch / LLM) | € |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(`| ${r.id} | ${r.urls} (${r.single}) | ${r.refused} | ${r.notOffer} | ${r.offers} | ${r.scores.join(", ") || "–"} | ${r.s60} | ${r.relevant} / ${r.partly} | ${r.fresh} | ${r.expired} | ${r.seconds} (${r.searchS} / ${r.fetchS} / ${r.extractS}) | ${r.eur.toFixed(3)} |`);
console.log(JSON.stringify({ totals: summary.totals, skipReasons: reasons, skipReasonsByUrlKind: reasonByKind, time: summary.timeSeconds, cost: summary.costEur }, null, 2));
