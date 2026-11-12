// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import type { LiveDiscoveryMetrics, MasterCvContent, SearchCriteria } from "@jobhub/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { JobSearchLive, ScoredJobOffer } from "@/job-searches";
import { OnboardingSearchCard, searchedWith, type RefiningCriterion } from "./OnboardingSearchCard";

const cv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};
const lyon = searchedWith({ masterCv: cv, searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } }).criteria;
const inCdi: SearchCriteria = { ...lyon, contractTypes: ["cdi"] };

/** Three Job Offers in Lyon: two in CDI, one in CDD; and one in Brest. */
const offers: ScoredJobOffer[] = [
  { id: "o1", title: "DAF", content: "DAF à Lyon.", location: "Lyon", contractType: "cdi" },
  { id: "o2", title: "Directrice financière", content: "À Lyon.", location: "Lyon", contractType: "cdi" },
  { id: "o3", title: "Contrôleuse de gestion", content: "À Lyon.", location: "Lyon", contractType: "cdd" },
  { id: "o4", title: "DAF", content: "À Brest.", location: "Brest", contractType: "cdi" },
];

const measuring = (over: Partial<LiveDiscoveryMetrics> = {}): LiveDiscoveryMetrics => ({
  step: "search",
  sources: [
    { source: "france_travail", state: "searched" },
    { source: "web_search", state: "searching" },
    { source: "ats_apis", state: "waiting" },
  ],
  pagesRead: 7,
  offersAnalysed: 4,
  matched: null,
  jobOfferIds: offers.map((offer) => offer.id),
  ...over,
});

describe("the onboarding's search card (#1001)", () => {
  /** What the poll answers next, and the polls made. */
  let answer: JobSearchLive;
  let polls: string[];
  let reduced: boolean;

  beforeEach(() => {
    answer = { id: "s1", status: "searching", failure: null, live: measuring(), jobOffers: offers };
    polls = [];
    reduced = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      // The Activity glyphs stay still in jsdom, which cannot measure their paths; the card asks for « reduce ».
      matches: query === "(prefers-reduced-motion: reduce)" && reduced,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("fetch", async (url: string) => {
      polls.push(url);
      const known = new URL(url, "https://app.example").searchParams.get("known")?.split(",") ?? [];
      return Response.json({ ...answer, jobOffers: answer.jobOffers.filter((offer) => !known.includes(offer.id)) });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function card(props: { criteria?: SearchCriteria; compact?: boolean; assumed?: readonly RefiningCriterion[] } = {}) {
    const element = (
      <ol>
        <OnboardingSearchCard jobSearchId="s1" criteria={props.criteria ?? lyon} cv={cv} compact={props.compact ?? true} assumed={props.assumed ?? []} pollMs={5} />
      </ol>
    );
    return element;
  }
  const region = () => screen.getByRole("region", { name: "Recherche de vos offres" });
  const counter = (label: string) => {
    // The label screen readers hear: the long and short ones on screen are hidden from them.
    const term = within(region()).getByText(label, { ignore: '[aria-hidden="true"]' });
    return term.closest("div")!.querySelector("dd")!.textContent;
  };

  it("shows 0 on every counter until the Job Search has measured something", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    renderInFrench(card());

    expect(counter("sources consultées")).toBe("0");
    expect(counter("pages lues")).toBe("0");
    expect(counter("offres analysées")).toBe("0");
    expect(counter("offres qui vous correspondent")).toBe("0");
  });

  it("shows the counters the run measured, and counts the Job Offers matching the Search Criteria of the moment by Match Score", async () => {
    renderInFrench(card());

    await waitFor(() => expect(counter("pages lues")).toBe("7"));
    expect(counter("sources consultées")).toBe("2 sur 3");
    expect(counter("offres analysées")).toBe("4");
    // Lyon, no contract wanted: the three in Lyon match, not the one in Brest.
    expect(counter("offres qui vous correspondent")).toBe("3");
    expect(within(region()).getByText(/Étape 2 sur 4/)).toBeTruthy();
    expect(within(region()).getByRole("link", { name: "Voir la recherche" }).getAttribute("href")).toBe("/recherches/s1");
    // Each Job Offer is asked for once: later polls name those the card has.
    await waitFor(() => expect(polls.length).toBeGreaterThan(1));
    expect(polls.at(-1)).toBe("/api/job-searches/s1/live?known=o1,o2,o3,o4");
  });

  it("recounts when a criterion is added, without a new search, and says only that it narrowed", async () => {
    answer = { ...answer, status: "done", live: measuring({ step: "analysis", matched: 3 }) };
    const { rerender } = renderInFrench(card());
    await waitFor(() => expect(counter("offres qui vous correspondent")).toBe("3"));
    expect(screen.getByRole("status").textContent).toMatch(/^Recherche terminée/);
    const pollsBefore = polls.length;

    rerender(<I18nProvider locale="fr">{card({ criteria: inCdi })}</I18nProvider>);

    // The CDD in Lyon no longer matches: the count goes down, and no search is asked for.
    expect(counter("offres qui vous correspondent")).toBe("2");
    expect(polls).toHaveLength(pollsBefore);
    expect(screen.getByRole("status").textContent).toBe("Recherche affinée avec CDI.");
    expect(within(region()).getByText("recalculé avec CDI")).toBeTruthy();
    expect(within(region()).getByText(/Affinée avec :/).textContent).toBe("Affinée avec : Directrice financière · Lyon · CDI");
  });

  it("says a criterion assumed and not confirmed yet in words, not by its look alone", async () => {
    renderInFrench(card({ criteria: inCdi, assumed: ["contractTypes"] }));

    const refined = within(region()).getByText(/Affinée avec :/);
    expect(refined.textContent).toBe("Affinée avec : Directrice financière · Lyon · CDI (supposé)");
    expect(within(refined).getByTitle("Supposé, en attente de votre réponse").textContent).toBe("CDI");
  });

  it("announces the start and the end in its own status region, never a counter changing", async () => {
    answer = { ...answer, live: measuring({ pagesRead: 1 }) };
    renderInFrench(card());
    const status = () => screen.getByRole("status");

    await waitFor(() => expect(status().textContent).toBe("Recherche de vos offres lancée."));
    // The card's counters are kept out of the thread's live region.
    expect(region().getAttribute("aria-live")).toBe("off");

    answer = { ...answer, live: measuring({ pagesRead: 12 }) };
    await waitFor(() => expect(counter("pages lues")).toBe("12"));
    expect(status().textContent).toBe("Recherche de vos offres lancée.");

    answer = { ...answer, status: "done", live: measuring({ step: "analysis", pagesRead: 12, matched: 3 }) };
    await waitFor(() => expect(status().textContent).toBe("Recherche terminée. Offres analysées : 4. Offres qui vous correspondent : 3."));
    const pollsAtEnd = polls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(polls).toHaveLength(pollsAtEnd);
  });

  it("says when the search failed or was stopped, with what it found", async () => {
    answer = { ...answer, status: "failed", failure: "discovery_failed", live: measuring({ step: "analysis", matched: 1 }) };
    renderInFrench(card({ compact: false }));

    const card_ = await screen.findByRole("heading", { name: "Recherche de vos offres" });
    const section = card_.closest("section")!;
    expect(await within(section).findByText("La recherche n'a pas abouti")).toBeTruthy();
    expect(within(section).getByText("Ce qu'elle a trouvé est gardé : 4 offres analysées.")).toBeTruthy();
    expect(within(section).getByText("Échouée")).toBeTruthy();
    // Nothing is said to be under way any more.
    expect(section.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("shows, whole, the sources' states and the steps, the step under way marked", async () => {
    renderInFrench(card({ compact: false }));

    const sources = await screen.findByRole("list", { name: "Sources de la recherche" });
    expect(within(sources).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "France Travailconsultée",
      "Recherche weben cours…",
      "API d'ATSà venir",
    ]);
    const steps = screen.getByRole("list", { name: "Étapes de la recherche" });
    const current = steps.querySelector('[aria-current="step"]')!;
    expect(current.textContent).toMatch(/^Recherche sur France Travail, les sites carrières et le web \(en cours\)/);
    expect(within(steps).getByText(/Lecture de votre profil/).textContent).toBe("Lecture de votre profil (terminé)");
  });

  it("stops every animation when the Candidate asks for reduced motion", async () => {
    reduced = true;
    const { container } = renderInFrench(card({ compact: false }));

    expect(container.querySelector(".onb-search-wrap")!.getAttribute("data-motion")).toBe("still");
  });

  it("moves when the Candidate did not ask for reduced motion", () => {
    const { container } = renderInFrench(card());

    expect(container.querySelector(".onb-search-wrap")!.hasAttribute("data-motion")).toBe(false);
  });
});
