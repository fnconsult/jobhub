import { describe, expect, it } from "vitest";
import { importanceTier, offerBoxView, postingAge } from "./offer-box";
import { offerBoxResponseSchema, type OfferBoxEntryRead, type OfferBoxResponse } from "./reads";

const TODAY = "2026-11-05";

/** An Offer box entry as `GET /api/offer-box` answers it: à traiter, arrived today by a Job Search, unless told otherwise. */
function entry(id: string, overrides: Partial<OfferBoxEntryRead> = {}): OfferBoxEntryRead {
  return {
    id,
    jobOffer: { id: `offer-${id}`, title: `Offre ${id}`, employer: "Acme", location: "Lyon", url: null, postedAt: null, expiredAt: null, contractType: "cdi" },
    profile: { id: "p1", name: "DAF" },
    scoredWith: { id: "p1", name: "DAF" },
    matchScore: 70,
    firstArrivalAt: "2026-11-05T08:00:00.000Z",
    arrivalDay: TODAY,
    sources: [{ source: "job_search", at: "2026-11-05T08:00:00.000Z" }],
    state: "to_handle",
    applicationId: null,
    followedAt: null,
    ...overrides,
  };
}

const box = (entries: OfferBoxEntryRead[]): OfferBoxResponse => ({ today: TODAY, toHandle: entries.filter((one) => one.state === "to_handle").length, entries });

describe("Importance tiers", () => {
  it("are « À ne pas manquer » from 80, « À regarder » from 60 to 79, « Peu adaptées » under 60 or not computable", () => {
    expect([100, 80, 79, 60, 59, 0, null].map(importanceTier)).toEqual(["not_to_miss", "not_to_miss", "to_look_at", "to_look_at", "less_suited", "less_suited", "less_suited"]);
  });
});

describe("A posting's age on an Offer box entry", () => {
  it("says « publiée il y a n j » from its Posting date, and « sort dans n j » in its last 7 days of 30", () => {
    expect(postingAge({ postedAt: "2026-11-05T06:00:00.000Z", firstArrivalAt: "2026-11-05T08:00:00.000Z" }, TODAY)).toEqual({ postedDaysAgo: 0, leavesInDays: null });
    expect(postingAge({ postedAt: "2026-10-12T10:00:00.000Z", firstArrivalAt: "2026-11-05T08:00:00.000Z" }, TODAY)).toEqual({ postedDaysAgo: 24, leavesInDays: 6 });
    expect(postingAge({ postedAt: "2026-10-13T10:00:00.000Z", firstArrivalAt: "2026-11-05T08:00:00.000Z" }, TODAY)).toEqual({ postedDaysAgo: 23, leavesInDays: 7 });
    expect(postingAge({ postedAt: "2026-10-14T10:00:00.000Z", firstArrivalAt: "2026-11-05T08:00:00.000Z" }, TODAY)).toEqual({ postedDaysAgo: 22, leavesInDays: null });
  });

  it("counts days in French time: a posting of 23:30 Paris time yesterday is a day old", () => {
    expect(postingAge({ postedAt: "2026-11-04T22:30:00.000Z", firstArrivalAt: "2026-11-05T08:00:00.000Z" }, TODAY).postedDaysAgo).toBe(1);
  });

  it("without a Posting date, says nothing of it and counts its 30 days from the first Arrival", () => {
    expect(postingAge({ postedAt: null, firstArrivalAt: "2026-10-10T08:00:00.000Z" }, TODAY)).toEqual({ postedDaysAgo: null, leavesInDays: 4 });
    expect(postingAge({ postedAt: null, firstArrivalAt: "2026-11-01T08:00:00.000Z" }, TODAY)).toEqual({ postedDaysAgo: null, leavesInDays: null });
  });
});

describe("The Offer box's view", () => {
  it("puts « Aujourd'hui » then « Précédemment », each by Importance tier, the most recent Arrival first within a tier", () => {
    const view = offerBoxView(
      box([
        entry("a", { matchScore: 85, firstArrivalAt: "2026-11-05T07:00:00.000Z" }),
        entry("b", { matchScore: 90, firstArrivalAt: "2026-11-05T09:00:00.000Z" }),
        entry("c", { matchScore: 65 }),
        entry("d", { matchScore: null }),
        entry("e", { matchScore: 82, arrivalDay: "2026-11-03", firstArrivalAt: "2026-11-03T09:00:00.000Z" }),
        entry("f", { matchScore: 40, arrivalDay: "2026-11-04", firstArrivalAt: "2026-11-04T09:00:00.000Z" }),
      ]),
    );

    expect(view.today.tiers.map(({ tier, entries }) => [tier, entries.map((one) => one.id)])).toEqual([
      ["not_to_miss", ["b", "a"]],
      ["to_look_at", ["c"]],
      ["less_suited", ["d"]],
    ]);
    expect(view.earlier.tiers.map(({ tier, entries }) => [tier, entries.map((one) => one.id)])).toEqual([
      ["not_to_miss", ["e"]],
      ["less_suited", ["f"]],
    ]);
  });

  it("folds the entries already suivies: today's under « Suivies aujourd'hui », earlier ones apart", () => {
    const followed = { state: "followed" as const, applicationId: "app", followedAt: "2026-11-05T10:00:00.000Z" };
    const view = offerBoxView(box([entry("a"), entry("b", followed), entry("c", { ...followed, arrivalDay: "2026-11-01" })]));

    expect(view.today.tiers.flatMap((tier) => tier.entries).map((one) => one.id)).toEqual(["a"]);
    expect(view.today.followed.map((one) => one.id)).toEqual(["b"]);
    expect(view.earlier.tiers).toEqual([]);
    expect(view.earlier.followed.map((one) => one.id)).toEqual(["c"]);
  });

  it("counts « N à traiter » and « k traitées » for the whole box, and each source chip what is still à traiter", () => {
    const view = offerBoxView(
      box([
        entry("a", { sources: [{ source: "job_search", at: "2026-11-05T08:00:00.000Z" }, { source: "email", at: "2026-11-05T09:00:00.000Z" }] }),
        entry("b", { sources: [{ source: "email", at: "2026-11-05T08:00:00.000Z" }] }),
        entry("c", { sources: [{ source: "job_offer_link", at: "2026-11-05T08:00:00.000Z" }], state: "followed", applicationId: "app", followedAt: "2026-11-05T10:00:00.000Z" }),
      ]),
    );

    expect(view.toHandle).toBe(2);
    expect(view.treated).toBe(1);
    expect(view.chips).toEqual([
      { source: "all", toHandle: 2 },
      { source: "job_search", toHandle: 1 },
      { source: "job_digest", toHandle: 0 },
      { source: "email", toHandle: 2 },
      { source: "job_offer_link", toHandle: 0 },
      { source: "extension", toHandle: 0 },
    ]);
  });

  it("filtered by a source chip, shows only the entries that arrived by it, the counts staying the whole box's", () => {
    const view = offerBoxView(
      box([entry("a", { sources: [{ source: "job_digest", at: "2026-11-05T08:00:00.000Z" }] }), entry("b"), entry("c", { arrivalDay: "2026-11-02", sources: [{ source: "job_digest", at: "2026-11-02T08:00:00.000Z" }] })]),
      "job_digest",
    );

    expect(view.today.tiers.flatMap((tier) => tier.entries).map((one) => one.id)).toEqual(["a"]);
    expect(view.earlier.tiers.flatMap((tier) => tier.entries).map((one) => one.id)).toEqual(["c"]);
    expect(view.toHandle).toBe(3);
  });
});

describe("GET /api/offer-box's schema", () => {
  it("parses an Offer box, and refuses a source it does not know", () => {
    expect(offerBoxResponseSchema.parse(box([entry("a")]))).toEqual(box([entry("a")]));
    expect(() => offerBoxResponseSchema.parse(box([entry("a", { sources: [{ source: "pigeon" as never, at: "2026-11-05T08:00:00.000Z" }] })]))).toThrow();
  });
});
