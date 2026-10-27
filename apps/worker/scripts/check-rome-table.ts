// Checks Job discovery's ROME table (src/job-discovery/france-travail/rome.ts) against France Travail's ROME
// open data (Licence Ouverte, no key): `npm run rome:check -w @jobhub/worker`. Run it after each ROME version
// (about yearly) and before widening the table. Exits 1, naming them, when the table holds codes ROME no longer lists.
import { fetchRomeJobs } from "@jobhub/web/reference-data";
import { romeTableGaps } from "../src/job-discovery/france-travail/rome";

const { jobs, version } = await fetchRomeJobs(globalThis.fetch);
const gaps = romeTableGaps(jobs);
if (gaps.length > 0) {
  console.error(`The ROME table holds ${gaps.length} code(s) ${version ?? "ROME 4.0"} does not list:`);
  for (const gap of gaps) console.error(`  ${gap.code} (${gap.label})`);
  process.exit(1);
}
console.info(`The ROME table is up to date with ${version ?? "ROME 4.0"} (${jobs.size} jobs).`);
