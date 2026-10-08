import { describe, expect, it } from "vitest";
import { createSourceRecheck, type SourceCheckOutcome, type SourceCheckStore } from "./index";

interface Page {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

/** A pretend Internet: every URL the re-check may request, and the requests it made. */
function fakeWeb(pages: Record<string, Page>) {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    const page = pages[url];
    if (!page) return new Response("introuvable", { status: 404 });
    return new Response(page.body ?? "", {
      status: page.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8", ...page.headers },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

/** Job Offers due a re-check, and what each re-check recorded. */
function memoryStore(due: { id: string; sourceUrl: string }[]): SourceCheckStore & { recorded: Map<string, SourceCheckOutcome> } {
  const recorded = new Map<string, SourceCheckOutcome>();
  return {
    recorded,
    async dueForRecheck(_now, limit) {
      return due.slice(0, limit);
    },
    async record(id, outcome) {
      recorded.set(id, outcome);
    },
  };
}

const NOW = new Date("2026-10-08T04:00:00Z");
const OFFER = "https://emploi.example.fr/offres/daf-lyon";

const posting = (extra: Record<string, unknown> = {}) => `<html><head><title>DAF H/F</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "DAF H/F", description: "Vous pilotez la finance du groupe.", ...extra })}</script>
</head><body><h1>DAF H/F</h1><p>Rattaché au Directeur général, vous pilotez la finance du groupe industriel, la consolidation IFRS et la trésorerie.</p></body></html>`;

function setup(pages: Record<string, Page>, due = [{ id: "offer-1", sourceUrl: OFFER }]) {
  const web = fakeWeb({ "https://emploi.example.fr/robots.txt": { body: "User-agent: *\nAllow: /", headers: { "content-type": "text/plain" } }, ...pages });
  const store = memoryStore(due);
  const recheck = createSourceRecheck({ store, fetch: web.fetch });
  return { recheck, store, web };
}

describe("re-checking a Job Offer at its source", () => {
  it("marks it expired when its page is gone (404 or 410)", async () => {
    const { recheck, store } = setup({ [OFFER]: { status: 410, body: "Offre supprimée" } });

    const report = await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("expired");
    expect(report.expired).toEqual(["offer-1"]);
  });

  it("leaves it published when its page still shows the posting", async () => {
    const { recheck, store } = setup({ [OFFER]: { body: posting() } });

    const report = await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("published");
    expect(report).toEqual({ checked: 1, expired: [], unknown: [] });
  });

  it("marks it expired when the posting's own closing date (JobPosting validThrough) has passed", async () => {
    const { recheck, store } = setup({ [OFFER]: { body: posting({ validThrough: "2026-09-30T23:59" }) } });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("expired");
  });

  it.each([
    "Cette offre n'est plus disponible.",
    "Désolé, cette offre d’emploi a expiré.",
    "Le poste a été pourvu.",
    "This job is no longer available",
    "This position has been filled.",
  ])("marks it expired when its page says so: %s", async (notice) => {
    const page = `<html><head><title>Offre</title></head><body><h1>DAF H/F</h1><p>${notice}</p><a href="/offres">Voir les autres offres</a></body></html>`;
    const { recheck, store } = setup({ [OFFER]: { body: page } });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("expired");
  });

  it("marks it expired when its page now sends visitors to the site's home page", async () => {
    const { recheck, store } = setup({
      [OFFER]: { status: 301, headers: { location: "https://emploi.example.fr/" } },
      "https://emploi.example.fr/": { body: "<html><body><h1>Bienvenue</h1><p>Nos offres d'emploi en France.</p></body></html>" },
    });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("expired");
  });

  it("leaves it published when it moved to another address that still shows the posting", async () => {
    const moved = "https://emploi.example.fr/offres/daf-lyon-123";
    const { recheck, store } = setup({
      [OFFER]: { status: 301, headers: { location: moved } },
      [moved]: { body: posting() },
    });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("published");
  });

  it("leaves it published when its live posting's footer asks to report an offer no longer available", async () => {
    const page = posting().replace(
      "</body>",
      `<footer><a href="/signaler">Une erreur ? Signalez-nous si cette offre n'est plus disponible.</a></footer></body>`,
    );
    const { recheck, store } = setup({ [OFFER]: { body: page } });

    const report = await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("published");
    expect(report.expired).toEqual([]);
  });

  it("leaves it published when a page without structured data only mentions expiry in its footer or a link", async () => {
    const page = `<html><head><title>DAF H/F</title></head><body><main><h1>DAF H/F</h1><p>Rattaché au Directeur général, vous pilotez la finance du groupe.</p></main>
<p><a href="/signaler">Signalez-nous si cette offre n'est plus disponible</a></p>
<footer>Une erreur ? Prévenez-nous si cette offre n'est plus disponible.</footer></body></html>`;
    const { recheck, store } = setup({ [OFFER]: { body: page } });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("published");
  });

  it("leaves it published when its text only says what happens if the offer is no longer available", async () => {
    const page = `<html><head><title>DAF H/F</title></head><body><h1>DAF H/F</h1><p>Vous pilotez la finance du groupe.</p><p>Si cette offre n'est plus disponible, nous vous proposerons des postes proches.</p></body></html>`;
    const { recheck, store } = setup({ [OFFER]: { body: page } });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("published");
  });

  it("leaves it published while its closing date is still ahead", async () => {
    const { recheck, store } = setup({ [OFFER]: { body: posting({ validThrough: "2026-12-31" }) } });

    await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("published");
  });
});

describe("re-checking within ADR-0002 rules", () => {
  it("never requests a page robots.txt keeps crawlers out of, and does not take that for expiry", async () => {
    const { recheck, store, web } = setup({
      "https://emploi.example.fr/robots.txt": { body: "User-agent: *\nDisallow: /offres/", headers: { "content-type": "text/plain" } },
      [OFFER]: { status: 410 },
    });

    const report = await recheck.run(NOW);

    expect(web.requests).toEqual(["https://emploi.example.fr/robots.txt"]);
    expect(store.recorded.get("offer-1")).toBe("unknown");
    expect(report.unknown).toEqual([{ id: "offer-1", reason: "robots" }]);
  });

  it("never fetches a Forbidden site: a Job Offer captured there is not re-checked", async () => {
    const linkedin = "https://fr.linkedin.com/jobs/view/123";
    const { recheck, store, web } = setup({}, [{ id: "offer-1", sourceUrl: linkedin }]);

    await recheck.run(NOW);

    expect(web.requests).toEqual([]);
    expect(store.recorded.get("offer-1")).toBe("unknown");
  });

  it("gives up at bot protection, without taking it for expiry", async () => {
    const challenge = `<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>`;
    const { recheck, store } = setup({ [OFFER]: { status: 403, body: challenge } });

    const report = await recheck.run(NOW);

    expect(store.recorded.get("offer-1")).toBe("unknown");
    expect(report.unknown).toEqual([{ id: "offer-1", reason: "bot_protection" }]);
  });

  it("introduces itself as the Jobbbox crawler", async () => {
    const userAgents: (string | null)[] = [];
    const store = memoryStore([{ id: "offer-1", sourceUrl: OFFER }]);
    const fetch = (async (_input: string, init?: RequestInit) => {
      userAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;

    await createSourceRecheck({ store, fetch }).run(NOW);

    expect(userAgents.every((agent) => agent?.startsWith("JobbboxBot/"))).toBe(true);
  });
});
