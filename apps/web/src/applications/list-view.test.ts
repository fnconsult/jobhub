import { describe, expect, it } from "vitest";
import type { ApplicationSummary } from "./index";
import { applicationListHref, applicationListView, isArchivedApplication, viewApplications } from "./list-view";

const now = new Date("2026-10-19T12:00:00Z");

function application(id: string, overrides: Partial<ApplicationSummary> & { profileName?: string; profileArchived?: boolean } = {}): ApplicationSummary {
  const { profileName = "DAF", profileArchived = false, ...rest } = overrides;
  return {
    id,
    status: "applied",
    statusChangedAt: now,
    createdAt: new Date(`2026-10-${10 + Number(id)}T09:00:00Z`),
    jobOffer: { id: `o${id}`, title: `Offre ${id}` },
    profile: { id: profileName === "DAF" ? "p-daf" : "p-other", name: profileName, archived: profileArchived },
    interviews: [],
    ...rest,
  };
}

const ids = (list: ApplicationSummary[]) => list.map((each) => each.id);
const view = (params: Record<string, string> = {}) => applicationListView(params);

describe("the Applications list's filters and sorting", () => {
  it("reads the view from the address, leaving what it does not know at its default", () => {
    expect(view()).toEqual({ profileId: null, status: null, showArchived: false, sort: null, order: "asc" });
    expect(view({ profil: "p-daf", statut: "interview", archivees: "1", tri: "statut", ordre: "desc" })).toEqual({
      profileId: "p-daf",
      status: "interview",
      showArchived: true,
      sort: "statut",
      order: "desc",
    });
    expect(view({ statut: "nope", tri: "nope", ordre: "sideways" })).toMatchObject({ status: null, sort: null, order: "asc" });
  });

  it("calls an Application archived at an end state or on an archived Profile", () => {
    expect(isArchivedApplication(application("1"))).toBe(false);
    for (const status of ["accepted", "rejected", "abandoned"] as const) expect(isArchivedApplication(application("1", { status }))).toBe(true);
    expect(isArchivedApplication(application("1", { profileArchived: true }))).toBe(true);
  });

  it("hides Archived Applications by default, latest saved first", () => {
    const all = [application("1"), application("2", { status: "rejected" }), application("3", { profileArchived: true }), application("4")];
    expect(ids(viewApplications(all, view(), "fr", now))).toEqual(["4", "1"]);
    expect(ids(viewApplications(all, view({ archivees: "1" }), "fr", now))).toEqual(["4", "3", "2", "1"]);
  });

  it("filters by Profile and by Status, an end state showing its Applications though archived ones are hidden", () => {
    const all = [application("1"), application("2", { profileName: "Consultante" }), application("3", { status: "rejected" })];
    expect(ids(viewApplications(all, view({ profil: "p-other" }), "fr", now))).toEqual(["2"]);
    expect(ids(viewApplications(all, view({ statut: "rejected" }), "fr", now))).toEqual(["3"]);
  });

  it("sorts by job offer, Profile, Status in the pipeline's order, or next interview to come (none last)", () => {
    const all = [
      application("1", { jobOffer: { id: "o1", title: "Contrôleur" }, status: "interview", interviews: [{ id: "i", scheduledAt: new Date("2026-10-25T09:00:00Z"), note: "", durationMinutes: null, format: null, place: "" }] }),
      application("2", { jobOffer: { id: "o2", title: "Acheteur" }, status: "to_apply", profileName: "Zoé" }),
      application("3", { jobOffer: { id: "o3", title: "Directeur" }, status: "offer_received", interviews: [{ id: "j", scheduledAt: new Date("2026-10-21T09:00:00Z"), note: "", durationMinutes: null, format: null, place: "" }] }),
    ];
    expect(ids(viewApplications(all, view({ tri: "offre" }), "fr", now))).toEqual(["2", "1", "3"]);
    expect(ids(viewApplications(all, view({ tri: "offre", ordre: "desc" }), "fr", now))).toEqual(["3", "1", "2"]);
    expect(ids(viewApplications(all, view({ tri: "profil" }), "fr", now))).toEqual(["3", "1", "2"]);
    expect(ids(viewApplications(all, view({ tri: "statut" }), "fr", now))).toEqual(["2", "1", "3"]);
    expect(ids(viewApplications(all, view({ tri: "entretiens" }), "fr", now))).toEqual(["3", "1", "2"]);
    expect(ids(viewApplications(all, view({ tri: "entretiens", ordre: "desc" }), "fr", now))).toEqual(["1", "3", "2"]);
  });

  it("writes the view back into an address, defaults left out", () => {
    expect(applicationListHref("/candidatures", view())).toBe("/candidatures");
    expect(applicationListHref("/candidatures", view({ profil: "p-daf" }), { sort: "statut", order: "desc" })).toBe("/candidatures?profil=p-daf&tri=statut&ordre=desc");
    expect(applicationListHref("/candidatures", view({ archivees: "1" }), { board: true })).toBe("/candidatures?vue=tableau&archivees=1");
  });
});
