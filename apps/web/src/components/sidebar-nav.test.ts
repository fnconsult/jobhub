import { describe, expect, it } from "vitest";
import { sidebarNav } from "./sidebar-nav";

const daf = { id: "p-daf", archived: false };
const consultant = { id: "p-consultant", archived: false };
const archived = { id: "p-archived", archived: true };

const links = (items: ReturnType<typeof sidebarNav>) => items.map(({ key, href }) => [key, href]);
const current = (items: ReturnType<typeof sidebarNav>) => items.filter((item) => item.current).map((item) => item.key);

describe("sidebarNav", () => {
  it("lists Applications, Job Searches, Job Digests, Account, Subscription and Human Coaches, the Profile ones leading to the Profile in view", () => {
    const items = sidebarNav({ pathname: "/profils/p-consultant", profiles: [daf, consultant], currentProfileId: "p-consultant" });
    expect(links(items)).toEqual([
      ["applications", "/candidatures"],
      ["jobSearches", "/profils/p-consultant#job-search-title"],
      ["jobDigests", "/profils/p-consultant#job-digest-title"],
      ["account", "/compte"],
      ["subscription", "/abonnement"],
      ["humanCoaches", "/coachs"],
    ]);
  });

  it("adds the Coach space for a Human Coach and the Back Office for an Administrator", () => {
    const keys = (flags: { isHumanCoach?: boolean; isAdministrator?: boolean }) => sidebarNav({ pathname: "/compte", profiles: [], ...flags }).map((item) => item.key);
    expect(keys({})).toEqual(["applications", "account", "subscription", "humanCoaches"]);
    expect(keys({ isHumanCoach: true, isAdministrator: true })).toEqual(["applications", "account", "subscription", "humanCoaches", "coachSpace", "admin"]);
  });

  it("leads Job Searches and Job Digests to the first active Profile when none is in view", () => {
    const items = sidebarNav({ pathname: "/compte", profiles: [archived, daf, consultant] });
    expect(links(items).slice(1, 3)).toEqual([
      ["jobSearches", "/profils/p-daf#job-search-title"],
      ["jobDigests", "/profils/p-daf#job-digest-title"],
    ]);
  });

  it("leads them to the first active Profile when the Profile in view is archived (it has neither section)", () => {
    const items = sidebarNav({ pathname: "/profils/p-archived", profiles: [archived, consultant], currentProfileId: "p-archived" });
    expect(links(items)[1]).toEqual(["jobSearches", "/profils/p-consultant#job-search-title"]);
  });

  it("leaves Job Searches and Job Digests out while the Candidate has no active Profile", () => {
    expect(sidebarNav({ pathname: "/compte", profiles: [] }).map((item) => item.key)).toEqual(["applications", "account", "subscription", "humanCoaches"]);
    expect(sidebarNav({ pathname: "/compte", profiles: [archived] }).map((item) => item.key)).toEqual(["applications", "account", "subscription", "humanCoaches"]);
  });

  it.each([
    ["/candidatures", ["applications"]],
    ["/candidatures/a-1", ["applications"]],
    ["/recherches/s-1", ["jobSearches"]],
    ["/job-digests/d-1", ["jobDigests"]],
    ["/compte", ["account"]],
    ["/compte/relances", ["account"]],
    ["/abonnement", ["subscription"]],
    ["/profils/p-daf", []],
    ["/coachs", ["humanCoaches"]],
    ["/offres/o-1", []],
    ["/compteur", []],
  ])("marks the item for %s as the current page", (pathname, expected) => {
    expect(current(sidebarNav({ pathname, profiles: [daf] }))).toEqual(expected);
  });
});
