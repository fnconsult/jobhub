import type { ExternalApiCall } from "../external-api-usage";
import { expect, it } from "vitest";
import { recordingJobBoardFetch } from "./polite-fetch";

const answering = (async () => new Response("{}")) as unknown as typeof globalThis.fetch;

it("records the calls to the job boards' APIs and pages (Greenhouse, Lever, Ashby, APEC) as free external API calls, and no other site (#218)", async () => {
  const calls: ExternalApiCall[] = [];
  const fetch = recordingJobBoardFetch(answering, { record: (call) => void calls.push(call) });

  for (const url of [
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123",
    "https://api.lever.co/v0/postings/acme/abc",
    "https://api.ashbyhq.com/posting-api/job-board/acme",
    "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/178",
    "https://careers.acme.example/jobs/daf",
  ]) {
    await fetch(url, {});
  }

  expect(calls.map(({ provider, operation, costEur }) => [provider, operation, costEur])).toEqual([
    ["greenhouse", "GET /v1/boards/acme/jobs/123", 0],
    ["lever", "GET /v0/postings/acme/abc", 0],
    ["ashby", "GET /posting-api/job-board/acme", 0],
    ["apec", "GET /candidat/recherche-emploi.html/emploi/detail-offre/178", 0],
  ]);
});
