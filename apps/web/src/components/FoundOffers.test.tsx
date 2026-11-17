// @vitest-environment jsdom
import type { OfferBoxEntryRead, OfferBoxResponse } from "@jobhub/shared/reads";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { FoundOffers } from "./OfferBox";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/job-digests/d1" }));

const TODAY = "2026-11-05";

function entry(id: string, matchScore: number, overrides: Partial<OfferBoxEntryRead> = {}): OfferBoxEntryRead {
  return {
    id,
    jobOffer: { id: `offer-${id}`, title: `Offre ${id}`, employer: "nLighten", location: "Paris", url: null, postedAt: "2026-10-08T08:00:00.000Z", expiredAt: null, contractType: null },
    profile: { id: "p1", name: "HEAD OF BU" },
    scoredWith: { id: "p1", name: "HEAD OF BU" },
    matchScore,
    firstArrivalAt: "2026-11-05T08:00:00.000Z",
    arrivalDay: TODAY,
    sources: [{ source: "job_digest", at: "2026-11-05T08:00:00.000Z" }],
    state: "to_handle",
    applicationId: null,
    followedAt: null,
    dismissalReason: null,
    dismissedAt: null,
    laterUntil: null,
    ...overrides,
  };
}

const box = (entries: OfferBoxEntryRead[]): OfferBoxResponse => ({ today: TODAY, toHandle: entries.length, entries });

describe("« Offres trouvées » as Recherches d'offres shows them", () => {
  it("lists each Job Offer with its Match Score and its actions, by day and Importance tier, without the box's header and source chips", () => {
    renderInFrench(<FoundOffers box={box([entry("a", 100), entry("b", 65, { arrivalDay: "2026-11-02", firstArrivalAt: "2026-11-02T08:00:00.000Z" })])} of={{ kind: "job_digest", id: "d1" }} />);

    const today = screen.getByRole("region", { name: "Aujourd'hui" });
    const line = within(today).getByRole("listitem", { name: "Offre a" });
    expect(within(line).getByRole("img", { name: /100/ })).toBeTruthy();
    expect(within(line).getByText("nLighten · Paris")).toBeTruthy();
    for (const action of [/^Suivre/, /^Écarter/, /^Plus tard/]) expect(within(line).getByRole("button", { name: action })).toBeTruthy();
    // « Lire l'offre » and the title open the Job Offer in the Work Pane, on the Job Digest's page.
    expect(within(line).getByRole("link", { name: "Lire l'offre" }).getAttribute("href")).toBe("/job-digests/d1/offres/offer-a");
    expect(within(line).getByRole("link", { name: "Offre a" }).getAttribute("href")).toBe("/job-digests/d1/offres/offer-a");
    expect(within(screen.getByRole("region", { name: "Précédemment" })).getByRole("listitem", { name: "Offre b" })).toBeTruthy();

    // No header: no count, no progress bar, no source chips.
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("group", { name: /source/i })).toBeNull();
    expect(screen.queryByRole("button", { pressed: true })).toBeNull();
  });

  it("opens a Job Search's at its own address", () => {
    renderInFrench(<FoundOffers box={box([entry("a", 90)])} of={{ kind: "job_search", id: "s1" }} />);
    expect(screen.getByRole("link", { name: "Lire l'offre" }).getAttribute("href")).toBe("/recherches/s1/offres/offer-a");
  });

  it("keeps the Job Offers found without an entry, after the others", () => {
    renderInFrench(<FoundOffers box={box([])} of={{ kind: "job_search", id: "s1" }} rest={<a href="/recherches/s1/offres/x">Offre x</a>} />);
    expect(screen.getByRole("link", { name: "Offre x" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Aujourd'hui" })).toBeNull();
  });
});
