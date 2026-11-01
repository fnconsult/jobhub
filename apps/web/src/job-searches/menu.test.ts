import { describe, expect, it } from "vitest";
import type { JobSearchSummary } from "./index";
import { jobSearchesMenu } from "./menu";

const DAF = { id: "p1", name: "DAF" };
const CONTROLE = { id: "p2", name: "Contrôle de gestion" };
const ARCHIVED = { id: "p3", name: "Ancien Profil" };

/** A Job Search started on 2026-10-`day`, done unless said otherwise. */
function search(id: string, profile: { id: string; name: string }, day: number, overrides: Partial<JobSearchSummary> = {}): JobSearchSummary {
  return { id, profile, status: "done", startedAt: new Date(Date.UTC(2026, 9, day, 8)), found: 3, unseen: false, ...overrides };
}

const dateLabel = (date: Date) => `${date.getUTCDate()} oct.`;

describe("Recherches d'offres as its menu conversation's card and its Sidebar objects (#606)", () => {
  it("groups the Job Searches by active Profile, in the Profiles' order, most recent first in each", () => {
    const menu = jobSearchesMenu({
      profiles: [DAF, CONTROLE],
      searches: [search("s4", CONTROLE, 20), search("s3", DAF, 18), search("s2", CONTROLE, 12), search("s1", DAF, 10)],
      dateLabel,
    });

    expect(menu.groups.map((group) => [group.profile.name, group.searches.map((each) => each.id)])).toEqual([
      ["DAF", ["s3", "s1"]],
      ["Contrôle de gestion", ["s4", "s2"]],
    ]);
  });

  it("keeps an active Profile with no Job Search yet, with none", () => {
    const menu = jobSearchesMenu({ profiles: [DAF, CONTROLE], searches: [search("s1", DAF, 10)], dateLabel });

    expect(menu.groups.map((group) => [group.profile.name, group.searches.length])).toEqual([
      ["DAF", 1],
      ["Contrôle de gestion", 0],
    ]);
  });

  it("leaves out the Job Searches of an Archived Profile, in the card and the Sidebar", () => {
    const menu = jobSearchesMenu({ profiles: [DAF], searches: [search("s2", ARCHIVED, 12), search("s1", DAF, 10)], dateLabel });

    expect(menu.groups.flatMap((group) => group.searches.map((each) => each.id))).toEqual(["s1"]);
    expect(menu.sidebar.shown.map((object) => object.id)).toEqual(["s1"]);
    expect(menu.sidebar.total).toBe(1);
  });

  it("unfolds the Sidebar into the most recent Job Searches, each named by its Profile and day, to its page", () => {
    const menu = jobSearchesMenu({ profiles: [DAF, CONTROLE], searches: [search("s2", CONTROLE, 12), search("s1", DAF, 10)], dateLabel });

    expect(menu.sidebar).toEqual({
      shown: [
        { id: "s2", label: "Contrôle de gestion · 12 oct.", href: "/recherches/s2", toHandle: false },
        { id: "s1", label: "DAF · 10 oct.", href: "/recherches/s1", toHandle: false },
      ],
      total: 2,
    });
  });

  it("marks à traiter a finished Job Search whose outcome is still unseen, and counts them", () => {
    const searches = [
      search("s7", DAF, 20),
      search("s6", DAF, 19),
      search("s5", DAF, 18),
      search("s4", DAF, 17),
      search("s3", DAF, 16),
      search("s2", DAF, 15),
      search("s1", DAF, 10, { unseen: true }),
    ];
    const menu = jobSearchesMenu({ profiles: [DAF], searches, dateLabel });

    expect(menu.unseen).toBe(1);
    expect(menu.sidebar.shown.map((object) => [object.id, object.toHandle])).toEqual([
      ["s7", false],
      ["s6", false],
      ["s5", false],
      ["s4", false],
      ["s1", true],
    ]);
    expect(menu.sidebar.total).toBe(7);
  });
});
