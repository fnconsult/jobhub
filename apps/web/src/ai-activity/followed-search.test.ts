import { describe, expect, it } from "vitest";
import type { CvContent, SearchCriteria } from "@jobhub/shared";
import type { ScoredJobOffer } from "../job-searches";
import { draftFromQuestionnaire, startQuestionnaire } from "../questionnaire";
import { activityEntries } from "./entries";
import { bestOffers, followedOn, followedSearchEntry, matchingCount, scored, searchSteps, type FollowedSearch } from "./followed-search";
import { nextLive, type LiveAction, type LiveChange } from "./live";

const at = "2026-11-12T09:00:00.000Z";
const id = "3f1c2a4e-0000-4000-8000-000000000001";
const cv: CvContent = { ...draftFromQuestionnaire(startQuestionnaire()).masterCv, fullName: "Marie Dupont", headline: "Directrice financière", location: "Lyon" };
const criteria = (more: Partial<SearchCriteria> = {}): SearchCriteria => ({
  targetRole: "Directrice financière",
  locations: ["Lyon"],
  contractTypes: [],
  remoteWorkOptions: [],
  sectors: [],
  subsectors: [],
  domains: [],
  ...more,
});
const offer = (key: string, more: Partial<ScoredJobOffer> = {}): ScoredJobOffer => ({ id: key, title: "Directrice financière", content: "Poste de directrice financière à Lyon.", location: "Lyon", ...more });

const followed = (more: Partial<FollowedSearch> = {}): FollowedSearch => ({ jobSearchId: id, href: "/profils/nouveau", matching: 0, refining: [], best: [], ...more });

function searchAction(change: Partial<LiveChange & { type: "job_searches" }> = {}): LiveAction {
  const running: LiveChange = {
    type: "job_searches",
    running: [{ jobSearchId: id, profile: { id: "p1", name: "Directrice financière" }, startedAt: at, steps: [], live: { step: "search", sources: [], pagesRead: 12, offersAnalysed: 4, matched: null } }],
    ended: [],
    at,
    ...change,
  };
  return nextLive([], running)[0]!;
}

describe("the Job Search a page follows as its own (#1001)", () => {
  it("is « ici » on the page that follows it only", () => {
    expect(followedOn(followed(), "/profils/nouveau")).toBe(`job_search:${id}`);
    expect(followedOn(followed(), "/candidatures")).toBeNull();
    expect(followedOn(null, "/profils/nouveau")).toBeNull();
  });

  it("counts the Job Offers that match the criteria of the moment, counted again when one is added, without a new search", () => {
    const offers = new Map([
      ["a", offer("a", { contractType: "cdi" })],
      ["b", offer("b", { contractType: "cdd" })],
    ]);
    const before = scored(offers, ["a", "b"], cv, criteria());
    const after = scored(offers, ["a", "b"], cv, criteria({ contractTypes: ["cdi"] }));
    expect(matchingCount(after)).toBeLessThanOrEqual(matchingCount(before));
    expect(after.find((one) => one.jobOffer.id === "b")!.score).toBeLessThan(before.find((one) => one.jobOffer.id === "b")!.score);
    // The run's order, but only the Job Offers the page has.
    expect(scored(offers, ["c", "a"], cv, criteria()).map((one) => one.jobOffer.id)).toEqual(["a"]);
  });

  it("ends with the 5 best that match, at least 3, each linked to its page in the Job Search", () => {
    const list = [90, 80, 70, 65, 62, 61, 30].map((score, index) => ({ jobOffer: offer(`o${index}`, { employer: index === 0 ? "Acme" : undefined }), score }));
    const best = bestOffers(id, list);
    expect(best).toHaveLength(5);
    expect(best[0]).toEqual({ title: "Directrice financière", employer: "Acme", score: 90, href: `/recherches/${id}/offres/o0` });
    expect(best[1]!.employer).toBeNull();
    expect(bestOffers(id, list.slice(5))).toHaveLength(2);
    expect(bestOffers(id, [...list.slice(5), { jobOffer: offer("x"), score: 10 }, { jobOffer: offer("y"), score: 5 }])).toHaveLength(3);
  });

  it("says where its four steps stand: searching, then analysing, done, or stopped with its selection not made", () => {
    expect(searchSteps({ status: "running", measured: null })).toEqual({ profile: "done", search: "current", analysis: "pending", selection: "pending" });
    expect(searchSteps({ status: "running", measured: { step: "analysis", sources: [], pagesRead: 1, offersAnalysed: 1, matched: null } })).toEqual({
      profile: "done",
      search: "done",
      analysis: "current",
      selection: "pending",
    });
    expect(searchSteps({ status: "done", measured: null })).toEqual({ profile: "done", search: "done", analysis: "done", selection: "done" });
    expect(searchSteps({ status: "stopped", measured: null })).toEqual({ profile: "done", search: "done", analysis: "pending", selection: "pending" });
  });

  it("once over, stays in the history of the page that followed it, with its best Job Offers and its page; offered, outside the Plan Quota", () => {
    const action = searchAction();
    expect(followedSearchEntry(followed(), action)).toBeNull();
    const done = nextLive([action], { type: "job_searches", running: [], ended: [{ jobSearchId: id, outcome: { status: "done", at: "2026-11-12T09:01:00.000Z", found: 4, steps: [] } }], at })[0]!;
    const best = [{ title: "DAF", employer: "Acme", score: 82, href: `/recherches/${id}/offres/o1` }];
    const entry = followedSearchEntry(followed({ best }), done)!;
    expect(entry).toMatchObject({ kind: "job_search", at, object: { href: `/recherches/${id}`, label: "Directrice financière" }, origin: "jobbbox", result: { end: { state: "done" }, offers: 4 }, offers: best });
    expect(entry.cost).toMatchObject({ quota: null, offered: true });
    expect(followedSearchEntry(followed({ jobSearchId: "other" }), done)).toBeNull();
    // Among the page's entries, newest first.
    expect(activityEntries({ page: "any", known: [entry] }).map((one) => one.kind)).toEqual(["job_search"]);
  });

  it("done with no Job Offer that matches, once the page has those it found, names its Profile for what to do next (#1006)", () => {
    const action = searchAction();
    const ended = (status: "done" | "failed" | "stopped") =>
      nextLive([action], { type: "job_searches", running: [], ended: [{ jobSearchId: id, outcome: { status, at: "2026-11-12T09:01:00.000Z", found: 4, steps: [], ...(status === "failed" ? { failure: "timeout", step: null } : {}) } }], at })[0]!;
    // It analysed 4: not until the page has them, they might match.
    expect(followedSearchEntry(followed({ profileId: "p1" }), ended("done"))!.noMatch).toBeUndefined();
    expect(followedSearchEntry(followed({ profileId: "p1", settled: true }), ended("done"))!.noMatch).toEqual({ profileId: "p1" });
    // One that matches, a failed or stopped one, or no Profile known: nothing of the kind.
    expect(followedSearchEntry(followed({ profileId: "p1", settled: true, matching: 1 }), ended("done"))!.noMatch).toBeUndefined();
    expect(followedSearchEntry(followed({ profileId: "p1", settled: true }), ended("failed"))!.noMatch).toBeUndefined();
    expect(followedSearchEntry(followed({ profileId: "p1", settled: true }), ended("stopped"))!.noMatch).toBeUndefined();
    expect(followedSearchEntry(followed({ settled: true }), ended("done"))!.noMatch).toBeUndefined();
  });
});
