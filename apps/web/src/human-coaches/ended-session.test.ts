import { describe, expect, it, vi } from "vitest";
import { legacyMayChangeSession } from "./ended-session";

// « Espace coach v2 » off (#1022): a Candidate no longer moves or cancels a session that has ended; its coach still may.
// Clocks are fixed instants (UTC), the session at 10:00 Paris time on 13 November 2026 (09:00 UTC, winter time).
const session = (row: { scheduledAt: Date | null; durationMinutes: number | null } | undefined) => ({
  query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }),
});
const at = new Date("2026-11-13T09:00:00Z");

describe("legacyMayChangeSession", () => {
  it("lets the Candidate change a session to come or under way", async () => {
    expect(await legacyMayChangeSession(session({ scheduledAt: at, durationMinutes: 45 }), "s1", "candidate", new Date("2026-11-13T08:59:59Z"))).toBe(true);
    expect(await legacyMayChangeSession(session({ scheduledAt: at, durationMinutes: 45 }), "s1", "candidate", new Date("2026-11-13T09:44:59Z"))).toBe(true);
  });
  it("refuses the Candidate once it has ended: start plus duration, an hour when unknown", async () => {
    expect(await legacyMayChangeSession(session({ scheduledAt: at, durationMinutes: 45 }), "s1", "candidate", new Date("2026-11-13T09:45:00Z"))).toBe("too_late");
    expect(await legacyMayChangeSession(session({ scheduledAt: at, durationMinutes: null }), "s1", "candidate", new Date("2026-11-13T09:59:59Z"))).toBe(true);
    expect(await legacyMayChangeSession(session({ scheduledAt: at, durationMinutes: null }), "s1", "candidate", new Date("2026-11-13T10:00:00Z"))).toBe("too_late");
  });
  it("never refuses an Unscheduled session, an unknown one (the module answers 404), or its Human Coach", async () => {
    const later = new Date("2030-01-01T00:00:00Z");
    expect(await legacyMayChangeSession(session({ scheduledAt: null, durationMinutes: 60 }), "s1", "candidate", later)).toBe(true);
    expect(await legacyMayChangeSession(session(undefined), "s1", "candidate", later)).toBe(true);
    const within = session({ scheduledAt: at, durationMinutes: 60 });
    expect(await legacyMayChangeSession(within, "s1", "coach", later)).toBe(true);
    expect(within.query).not.toHaveBeenCalled();
  });
});
