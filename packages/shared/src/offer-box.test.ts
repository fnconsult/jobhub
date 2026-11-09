import { describe, expect, it } from "vitest";
import { importanceTier, isExpiredWithoutDecision, nextMondayInParis, offerBoxView, postingAge } from "./offer-box";
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
    dismissalReason: null,
    dismissedAt: null,
    laterUntil: null,
    ...overrides,
  };
}

const box = (entries: OfferBoxEntryRead[]): OfferBoxResponse => ({ today: TODAY, toHandle: entries.filter((one) => one.state === "to_handle" || one.state === "later").length, entries });

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

describe("« Plus tard » (#817)", () => {
  const until = (now: string) => nextMondayInParis(new Date(now)).toISOString();

  it("lasts until the next Monday 00:00 Paris time, never a date the Candidate picks", () => {
    // Thursday 5 November 2026, winter time (UTC+1): Monday 9 November 00:00 in Paris.
    expect(until("2026-11-05T10:00:00+01:00")).toBe("2026-11-08T23:00:00.000Z");
    // Sunday 23:30 in Paris: tomorrow.
    expect(until("2026-11-08T23:30:00+01:00")).toBe("2026-11-08T23:00:00.000Z");
  });

  it("put on a Monday, lasts until the Monday after, the day counted in Paris time, not UTC", () => {
    expect(until("2026-11-09T10:00:00+01:00")).toBe("2026-11-15T23:00:00.000Z");
    // 00:30 on Monday in Paris is still Sunday in UTC.
    expect(until("2026-11-09T00:30:00+01:00")).toBe("2026-11-15T23:00:00.000Z");
  });

  it("across a change of time, is still Monday 00:00 Paris time", () => {
    // Summer time ends on Sunday 25 October 2026: Monday 26 October 00:00 is UTC+1.
    expect(until("2026-10-22T10:00:00+02:00")).toBe("2026-10-25T23:00:00.000Z");
    // Summer time starts on Sunday 29 March 2026: Monday 30 March 00:00 is UTC+2.
    expect(until("2026-03-26T10:00:00+01:00")).toBe("2026-03-29T22:00:00.000Z");
    // Put on the Sunday of the change itself.
    expect(until("2026-03-29T12:00:00+02:00")).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("« Expirées sans décision » (#817)", () => {
  it("is an entry whose Posting date passed 30 days, in French days", () => {
    expect(isExpiredWithoutDecision({ postedAt: "2026-10-06T10:00:00.000Z", firstArrivalAt: "2026-11-01T08:00:00.000Z" }, TODAY)).toBe(false);
    expect(isExpiredWithoutDecision({ postedAt: "2026-10-05T10:00:00.000Z", firstArrivalAt: "2026-11-01T08:00:00.000Z" }, TODAY)).toBe(true);
    // 22:30 UTC on 5 October is 00:30 on the 6th in Paris (summer time): 30 days, not more.
    expect(isExpiredWithoutDecision({ postedAt: "2026-10-05T22:30:00.000Z", firstArrivalAt: "2026-11-01T08:00:00.000Z" }, TODAY)).toBe(false);
  });

  it("without a Posting date, counts the 30 days from the first Arrival", () => {
    expect(isExpiredWithoutDecision({ postedAt: null, firstArrivalAt: "2026-10-06T08:00:00.000Z" }, TODAY)).toBe(false);
    expect(isExpiredWithoutDecision({ postedAt: null, firstArrivalAt: "2026-10-05T08:00:00.000Z" }, TODAY)).toBe(true);
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
      { source: "share", toHandle: 0 },
    ]);
  });

  it("filtered by « Extension » or « Partage », shows the Captures and Share captures followed, already « Suivies » (#819)", () => {
    const followed = { state: "followed", applicationId: "app", followedAt: "2026-11-05T10:00:00.000Z" } as const;
    const view = (filter: "extension" | "share") =>
      offerBoxView(
        box([
          entry("captured", { sources: [{ source: "extension", at: "2026-11-05T10:00:00.000Z" }], ...followed }),
          entry("shared", { sources: [{ source: "share", at: "2026-11-05T11:00:00.000Z" }], ...followed }),
          entry("searched"),
        ]),
        filter,
      );

    expect(view("extension").today).toEqual({ tiers: [], followed: [expect.objectContaining({ id: "captured" })] });
    expect(view("share").today).toEqual({ tiers: [], followed: [expect.objectContaining({ id: "shared" })] });
    expect(view("share").chips.slice(-2)).toEqual([
      { source: "extension", toHandle: 0 },
      { source: "share", toHandle: 0 },
    ]);
  });

  it("counts « n arrivées aujourd'hui » for the whole box, whatever each has become, whatever the chip (#898)", () => {
    const entries = [
      entry("a"),
      entry("b", { sources: [{ source: "email", at: "2026-11-05T08:00:00.000Z" }], state: "dismissed", dismissedAt: "2026-11-05T09:00:00.000Z" }),
      entry("c", { state: "followed", applicationId: "app", followedAt: "2026-11-05T10:00:00.000Z" }),
      entry("old", { arrivalDay: "2026-11-02" }),
    ];

    expect(offerBoxView(box(entries)).arrivedToday).toBe(3);
    expect(offerBoxView(box(entries), "email").arrivedToday).toBe(3);
    expect(offerBoxView(box([entry("old", { arrivalDay: "2026-11-02" })])).arrivedToday).toBe(0);
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

  it("puts the entries écartées in « Écartées », the latest écartée first, out of the days and the count, counted traitées (#816)", () => {
    const dismissed = (at: string, arrivalDay = TODAY) => ({ state: "dismissed" as const, dismissalReason: "salary" as const, dismissedAt: at, arrivalDay });
    const view = offerBoxView(box([entry("a"), entry("old", dismissed("2026-11-01T08:00:00.000Z", "2026-10-30")), entry("new", dismissed("2026-11-05T09:00:00.000Z"))]));

    expect(view.dismissed.map((one) => one.id)).toEqual(["new", "old"]);
    expect([...view.today.tiers.flatMap((tier) => tier.entries), ...view.today.followed, ...view.earlier.tiers.flatMap((tier) => tier.entries), ...view.earlier.followed].map((one) => one.id)).toEqual(["a"]);
    expect(view.toHandle).toBe(1);
    expect(view.treated).toBe(2);
    expect(view.chips[0]).toEqual({ source: "all", toHandle: 1 });
  });
  it("puts the entries « Plus tard » in their own block, out of the days but still à traiter and counted (#817)", () => {
    const later = { state: "later" as const, laterUntil: "2026-11-08T23:00:00.000Z" };
    const view = offerBoxView(
      box([entry("a"), entry("b", later), entry("c", { ...later, arrivalDay: "2026-11-02", sources: [{ source: "email", at: "2026-11-02T08:00:00.000Z" }] })]),
    );

    expect(view.later.map((one) => one.id)).toEqual(["b", "c"]);
    expect([...view.today.tiers.flatMap((tier) => tier.entries), ...view.earlier.tiers.flatMap((tier) => tier.entries)].map((one) => one.id)).toEqual(["a"]);
    expect(view.toHandle).toBe(3);
    expect(view.treated).toBe(0);
    expect(view.chips.find((chip) => chip.source === "email")).toEqual({ source: "email", toHandle: 1 });
    expect(offerBoxView(box([entry("b", later), entry("c", { ...later, sources: [{ source: "email", at: "2026-11-02T08:00:00.000Z" }] })]), "email").later.map((one) => one.id)).toEqual(["c"]);
  });

  it("brings an entry « Plus tard » back under « Aujourd'hui » on its Monday, then lets it go back to its arrival day", () => {
    const back = entry("back", { arrivalDay: "2026-11-04", firstArrivalAt: "2026-11-04T08:00:00.000Z", laterUntil: "2026-11-08T23:00:00.000Z" });
    const monday = { ...box([back]), today: "2026-11-09" };
    const tuesday = { ...box([back]), today: "2026-11-10" };

    expect(offerBoxView(monday).today.tiers.flatMap((tier) => tier.entries).map((one) => one.id)).toEqual(["back"]);
    expect(offerBoxView(monday).earlier.tiers).toEqual([]);
    expect(offerBoxView(tuesday).earlier.tiers.flatMap((tier) => tier.entries).map((one) => one.id)).toEqual(["back"]);
  });

  it("puts the entries « Expirées sans décision » in their own block, the most recent Arrival first, out of the days and of the count (#817)", () => {
    const expired = (arrivalDay: string) => ({ state: "expired" as const, arrivalDay, firstArrivalAt: `${arrivalDay}T08:00:00.000Z` });
    const view = offerBoxView(box([entry("a"), entry("old", expired("2026-10-01")), entry("new", expired("2026-10-03"))]));

    expect(view.expired.map((one) => one.id)).toEqual(["new", "old"]);
    expect(view.earlier.tiers.flatMap((tier) => tier.entries).map((one) => one.id)).toEqual([]);
    expect(view.toHandle).toBe(1);
    expect(view.treated).toBe(0);
    expect(view.chips[0]).toEqual({ source: "all", toHandle: 1 });
  });

  it("gives « Tout écarter » in « Précédemment » exactly one tier's entries à traiter, within the source chip", () => {
    const earlier = (id: string, matchScore: number, source: "job_search" | "email" = "job_search") =>
      entry(id, { matchScore, arrivalDay: "2026-11-03", firstArrivalAt: "2026-11-03T08:00:00.000Z", sources: [{ source, at: "2026-11-03T08:00:00.000Z" }] });
    const entries = [
      earlier("top", 85),
      earlier("mid1", 70),
      earlier("mid2", 65, "email"),
      earlier("mid3", 62),
      entry("todayMid", { matchScore: 70 }),
      { ...earlier("laterMid", 70), state: "later" as const, laterUntil: "2026-11-08T23:00:00.000Z" },
      { ...earlier("expiredMid", 70), state: "expired" as const },
    ];

    expect(offerBoxView(box(entries)).earlier.tiers.map(({ tier, entries }) => [tier, entries.map((one) => one.id)])).toEqual([
      ["not_to_miss", ["top"]],
      ["to_look_at", ["mid1", "mid2", "mid3"]],
    ]);
    expect(offerBoxView(box(entries), "job_search").earlier.tiers.find(({ tier }) => tier === "to_look_at")!.entries.map((one) => one.id)).toEqual(["mid1", "mid3"]);
  });
});

describe("GET /api/offer-box's schema", () => {
  it("parses an Offer box, and refuses a source it does not know", () => {
    expect(offerBoxResponseSchema.parse(box([entry("a")]))).toEqual(box([entry("a")]));
    expect(() => offerBoxResponseSchema.parse(box([entry("a", { sources: [{ source: "pigeon" as never, at: "2026-11-05T08:00:00.000Z" }] })]))).toThrow();
  });
});
