import type { MatchScore } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { FollowUpNotice } from "../follow-ups";
import type { ApplicationSummary } from "./index";
import { applicationsMenu } from "./menu";

const DAY = 86_400_000;
let saved = 0;

/** An Application saved `daysAgo`, newest first in the list as the Applications module gives it. */
function application(id: string, overrides: Partial<ApplicationSummary> & { title?: string; employer?: string; daysAgo?: number } = {}): ApplicationSummary {
  const { title = `Poste ${id}`, employer, daysAgo = (saved += 1), ...rest } = overrides;
  const at = new Date(Date.UTC(2026, 9, 31) - daysAgo * DAY);
  return {
    id,
    status: "to_apply",
    statusChangedAt: at,
    createdAt: at,
    jobOffer: { id: `offer-${id}`, title, ...(employer ? { employer } : {}) },
    profile: { id: "p1", name: "DAF", archived: false },
    interviews: [],
    ...rest,
  };
}

function score(value: number, known = true): MatchScore {
  const unknown = { status: "unknown" } as const;
  return {
    score: value,
    breakdown: {
      skills: known ? { status: "match", covered: ["IFRS"], missing: [] } : unknown,
      seniority: known ? { status: "match", cvYears: 19, requiredYears: 15 } : unknown,
      location: known ? { status: "match", offer: "Lyon", wanted: ["Lyon"] } : unknown,
      salary: unknown,
      contractType: known ? { status: "match", offer: "cdi", wanted: ["cdi"] } : unknown,
    },
  } as MatchScore;
}

const followUp = (applicationId: string): FollowUpNotice => ({ applicationId, jobTitle: "", kind: "follow_up" });
const abandon = (applicationId: string): FollowUpNotice => ({ applicationId, jobTitle: "", kind: "abandon_suggestion" });

describe("Mes candidatures as its menu conversation's card and its Sidebar objects (#604)", () => {
  it("lists each Application with its status, its Match Score and whether it is à traiter, latest saved first", () => {
    const menu = applicationsMenu({
      applications: [application("a1", { title: "DAF H/F", employer: "Acme", status: "applied" }), application("a2", { title: "Contrôleur de gestion" })],
      notices: [followUp("a1")],
      matchScores: new Map([["a1", score(85)], ["a2", score(0, false)]]),
    });

    expect(menu.rows).toEqual([
      { id: "a1", title: "DAF H/F", employer: "Acme", status: "applied", matchScore: 85, toHandle: "follow_up" },
      { id: "a2", title: "Contrôleur de gestion", employer: null, status: "to_apply", matchScore: null, toHandle: null },
    ]);
    expect(menu.toHandle).toBe(1);
  });

  it("leaves out Archived Applications, counting them, until the Candidate asks for them", () => {
    const applications = [
      application("a1"),
      application("a2", { status: "rejected" }),
      application("a3", { profile: { id: "p2", name: "Ancien", archived: true } }),
    ];

    const hidden = applicationsMenu({ applications, notices: [], matchScores: new Map() });
    expect(hidden.rows.map((row) => row.id)).toEqual(["a1"]);
    expect(hidden.archivedHidden).toBe(2);

    const shown = applicationsMenu({ applications, notices: [], matchScores: new Map(), showArchived: true });
    expect(shown.rows.map((row) => row.id)).toEqual(["a1", "a2", "a3"]);
    expect(shown.archivedHidden).toBe(0);
  });

  it("gives the Sidebar the Applications it lists, each to its page, named by employer and title, à traiter when a Follow-up or an « Abandonnée » suggestion waits", () => {
    const menu = applicationsMenu({
      applications: [application("a1", { title: "DAF H/F", employer: "Acme" }), application("a2", { title: "Contrôleur de gestion" }), application("a3", { status: "accepted" })],
      notices: [abandon("a2")],
      matchScores: new Map(),
    });

    expect(menu.sidebar).toEqual({
      shown: [
        { id: "a1", label: "Acme · DAF H/F", href: "/candidatures/a1", toHandle: false },
        { id: "a2", label: "Contrôleur de gestion", href: "/candidatures/a2", toHandle: true },
      ],
      total: 2,
    });
  });
});
