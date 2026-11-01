import { describe, expect, it } from "vitest";
import type { ListedJobDigest } from "./index";
import { jobDigestsMenu } from "./menu";

const DAF = { id: "p1", name: "DAF" };
const CONTROLE = { id: "p2", name: "Contrôle de gestion" };
const ARCHIVED = { id: "p3", name: "Ancien Profil" };

/** A Job Digest sent on 2026-10-`day`. */
const digest = (id: string, profile: { id: string; name: string }, day: number, count = 4): ListedJobDigest => ({ id, profile, sentAt: new Date(Date.UTC(2026, 9, day, 5)), count });

const dateLabel = (date: Date) => `${date.getUTCDate()} oct.`;

describe("Job Digests as its menu conversation's card and its Sidebar objects (#606)", () => {
  it("groups the Job Digests by active Profile, in the Profiles' order, newest first in each", () => {
    const menu = jobDigestsMenu({
      profiles: [DAF, CONTROLE],
      digests: [digest("d4", CONTROLE, 26), digest("d3", DAF, 19), digest("d2", CONTROLE, 19), digest("d1", DAF, 12)],
      dateLabel,
    });

    expect(menu.groups.map((group) => [group.profile.name, group.digests.map((each) => each.id)])).toEqual([
      ["DAF", ["d3", "d1"]],
      ["Contrôle de gestion", ["d4", "d2"]],
    ]);
  });

  it("unfolds the Sidebar into the newest Job Digests, each named by its Profile and day, to its page; an Archived Profile's left out", () => {
    const digests = [digest("d7", DAF, 26), digest("d6", ARCHIVED, 25), digest("d5", DAF, 19), digest("d4", CONTROLE, 19), digest("d3", DAF, 12), digest("d2", CONTROLE, 12), digest("d1", DAF, 5)];
    const menu = jobDigestsMenu({ profiles: [DAF, CONTROLE], digests, dateLabel });

    expect(menu.sidebar.shown).toEqual([
      { id: "d7", label: "DAF · 26 oct.", href: "/job-digests/d7", toHandle: false },
      { id: "d5", label: "DAF · 19 oct.", href: "/job-digests/d5", toHandle: false },
      { id: "d4", label: "Contrôle de gestion · 19 oct.", href: "/job-digests/d4", toHandle: false },
      { id: "d3", label: "DAF · 12 oct.", href: "/job-digests/d3", toHandle: false },
      { id: "d2", label: "Contrôle de gestion · 12 oct.", href: "/job-digests/d2", toHandle: false },
    ]);
    expect(menu.sidebar.total).toBe(6);
    expect(menu.groups.flatMap((group) => group.digests.map((each) => each.id))).not.toContain("d6");
  });
});
