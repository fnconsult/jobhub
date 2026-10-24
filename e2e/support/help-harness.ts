import { articleFor, articles, search } from "@jobhub/help";

// Loads @jobhub/help through its public entry point in a fresh process and prints, as one JSON line, what it finds.
// argv: a JSON array of [query, locale] pairs.
const queries = JSON.parse(process.argv[2] ?? "[]") as [string, "fr" | "en"][];
const ids = (query: string, locale: "fr" | "en") => search(query, locale).map((entry) => entry.id);

search("warm up", "fr");
const timed = ["comment relancer le recruteur", "négocier mon salaire", "quand se renouvelle mon quota", "score de correspondance", "supprimer mon compte"];
const runs = 200;
const start = performance.now();
for (let run = 0; run < runs; run++) search(timed[run % timed.length]!, "fr");
const perSearchMs = (performance.now() - start) / runs;

console.log(
  "HELP_RESULT " +
    JSON.stringify({
      results: queries.map(([query, locale]) => ids(query, locale)),
      counts: { fr: articles("fr").length, en: articles("en").length },
      homeKind: articleFor("/", "en")?.kind ?? null,
      perSearchMs,
    }),
);
