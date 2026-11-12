import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createHumanCoaches, type HumanCoachesDeps } from "./index";

// « Espace coach v2 » (ADR-0106): off, the module answers as before the Human Coach epic, whatever the epic's deps say.
// No database: a fake pool records the SQL it is asked.
const COACH = { id: "8e2f6f0c-6a55-4d6b-9a52-0c2a8f0a1f11", name: "Claire Martin", email: "claire@example.com", booking_url: "https://cal.com/claire", bio: "" };
const PERSON = { email: " Claire@Example.com ", emailVerified: true };

function setUp(on: boolean | undefined) {
  const query = vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: (typeof COACH)[] }>>(async () => ({ rows: [COACH] }));
  const mayEnter = vi.fn(async () => false);
  const publishedCoachIds = vi.fn(async () => []);
  const deps = {
    ...(on === undefined ? {} : { coachSpaceV2On: () => on }),
    mayEnter,
    publishedCoachIds,
    profiles: {},
    applications: {},
    tailoredDocuments: {},
    tailoredCvs: {},
    push: {},
  } as unknown as HumanCoachesDeps;
  return { coaches: createHumanCoaches({ query } as unknown as Pool, deps), query, mayEnter, publishedCoachIds };
}

const coach = { id: COACH.id, name: COACH.name, email: COACH.email, bookingUrl: COACH.booking_url, bio: COACH.bio };

describe("Human Coaches with « Espace coach v2 » off: as on main", () => {
  it("lists every non-retired Human Coach: no contract, page approval or moderation filter", async () => {
    const { coaches, query, publishedCoachIds } = setUp(false);
    expect(await coaches.list()).toEqual([coach]);
    expect(query).toHaveBeenCalledWith("SELECT id, name, email, booking_url, bio FROM human_coach WHERE retired_at IS NULL ORDER BY name, created_at");
    expect(publishedCoachIds).not.toHaveBeenCalled();
  });

  it("lets an active Human Coach in without a contract check", async () => {
    const { coaches, query, mayEnter } = setUp(false);
    expect(await coaches.coachSignedIn(PERSON)).toEqual(coach);
    expect(query).toHaveBeenCalledWith("SELECT id, name, email, booking_url, bio FROM human_coach WHERE email = $1 AND retired_at IS NULL", ["claire@example.com"]);
    expect(mayEnter).not.toHaveBeenCalled();
  });

  it("still keeps an unverified email out", async () => {
    const { coaches, query } = setUp(false);
    expect(await coaches.coachSignedIn({ ...PERSON, emailVerified: false })).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});

describe.each([true, undefined])("Human Coaches with « Espace coach v2 » on (dep %s): the epic's rules", (on) => {
  it("lists only published Human Coaches", async () => {
    const { coaches, query, publishedCoachIds } = setUp(on);
    expect(await coaches.list()).toEqual([]);
    expect(String(query.mock.calls[0]?.[0])).toContain("NOT contract_pending AND public_ready");
    expect(publishedCoachIds).toHaveBeenCalledWith([COACH.id]);
  });

  it("asks the contract before letting a Human Coach in", async () => {
    const { coaches, query, mayEnter } = setUp(on);
    expect(await coaches.coachSignedIn(PERSON)).toBeNull();
    expect(String(query.mock.calls[0]?.[0])).toContain("NOT contract_pending");
    expect(mayEnter).toHaveBeenCalledWith(PERSON, COACH.id);
  });
});
