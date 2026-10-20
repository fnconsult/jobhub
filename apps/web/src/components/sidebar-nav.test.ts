import { describe, expect, it } from "vitest";
import { accountLink, sidebarNav } from "./sidebar-nav";

const daf = { id: "p-daf", archived: false };
const consultant = { id: "p-consultant", archived: false };
const archived = { id: "p-archived", archived: true };

const links = (items: ReturnType<typeof sidebarNav>) => items.map(({ key, href }) => [key, href]);
const current = (items: ReturnType<typeof sidebarNav>) => items.filter((item) => item.current).map((item) => item.key);

describe("sidebarNav", () => {
  it("lists Applications, the Agenda, Job Searches, Job Digests and Human Coaches, the Profile ones leading to the Profile in view", () => {
    const items = sidebarNav({ pathname: "/profils/p-consultant", profiles: [daf, consultant], currentProfileId: "p-consultant" });
    expect(links(items)).toEqual([
      ["applications", "/candidatures"],
      ["agenda", "/agenda"],
      ["jobSearches", "/recherches?profil=p-consultant"],
      ["jobDigests", "/job-digests"],
      ["humanCoaches", "/coachs"],
    ]);
  });

  it("adds the Coach space for a Human Coach and the Back Office for an Administrator", () => {
    const keys = (flags: { isHumanCoach?: boolean; isAdministrator?: boolean }) => sidebarNav({ pathname: "/compte", profiles: [], ...flags }).map((item) => item.key);
    expect(keys({})).toEqual(["applications", "agenda", "humanCoaches"]);
    expect(keys({ isHumanCoach: true, isAdministrator: true })).toEqual(["applications", "agenda", "humanCoaches", "coachSpace", "admin"]);
  });

  it("leads Job Searches and Job Digests to the first active Profile when none is in view", () => {
    const items = sidebarNav({ pathname: "/compte", profiles: [archived, daf, consultant] });
    expect(links(items).slice(2, 4)).toEqual([
      ["jobSearches", "/recherches?profil=p-daf"],
      ["jobDigests", "/job-digests"],
    ]);
  });

  it("leads them to the first active Profile when the Profile in view is archived (it has neither section)", () => {
    const items = sidebarNav({ pathname: "/profils/p-archived", profiles: [archived, consultant], currentProfileId: "p-archived" });
    expect(links(items)[2]).toEqual(["jobSearches", "/recherches?profil=p-consultant"]);
  });

  it("leaves Job Searches and Job Digests out while the Candidate has no active Profile", () => {
    expect(sidebarNav({ pathname: "/compte", profiles: [] }).map((item) => item.key)).toEqual(["applications", "agenda", "humanCoaches"]);
    expect(sidebarNav({ pathname: "/compte", profiles: [archived] }).map((item) => item.key)).toEqual(["applications", "agenda", "humanCoaches"]);
  });

  it.each([
    ["/candidatures", ["applications"]],
    ["/candidatures/a-1", ["applications"]],
    ["/agenda", ["agenda"]],
    ["/agendas", []],
    ["/recherches/s-1", ["jobSearches"]],
    ["/job-digests/d-1", ["jobDigests"]],
    ["/recherches", ["jobSearches"]],
    ["/job-digests", ["jobDigests"]],
    ["/compte", []],
    ["/abonnement", []],
    ["/profils/p-daf", []],
    ["/coachs", ["humanCoaches"]],
    ["/offres/o-1", []],
    ["/compteur", []],
  ])("marks the item for %s as the current page", (pathname, expected) => {
    expect(current(sidebarNav({ pathname, profiles: [daf] }))).toEqual(expected);
  });

  it.each([
    ["/compte", true],
    ["/compte/relances", true],
    ["/abonnement", true],
    ["/compteur", false],
    ["/candidatures", false],
  ])("Mon compte, in the sidebar's foot, is current on %s: %s", (pathname, expected) => {
    expect(accountLink(pathname)).toEqual({ href: "/compte", current: expected });
  });
});
