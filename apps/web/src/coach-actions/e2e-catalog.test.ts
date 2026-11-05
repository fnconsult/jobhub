import { describe, expect, it, vi } from "vitest";
import type { Applications } from "../applications";
import { E2E_SLOW_READ_ACTION, e2eCoachActions } from "./e2e-catalog";

const applications = {
  get: vi.fn(async (candidateId: string, id: string) => (candidateId === "marie" && id === "a1" ? { jobOffer: { title: "Contrôleuse de gestion", employer: "Airbus" } } : null)),
  statusOf: vi.fn(),
  change: vi.fn(),
} as unknown as Pick<Applications, "get" | "statusOf" | "change">;

const slowRead = () => e2eCoachActions(applications).find((action) => action.name === E2E_SLOW_READ_ACTION)!;

describe("the e2e suite's slow read (#788): a Coach Action that takes its time, so its step is seen live", () => {
  it("reads the Candidate's Application after `ms`, its page as the reply's Provenance site", async () => {
    vi.useFakeTimers();
    const ran = slowRead().run({ id: "a1", ms: 2000 }, { candidateId: "marie", language: "fr" });
    let done = false;
    void ran.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();

    expect(await ran).toEqual({ ok: true, data: "Candidature : Contrôleuse de gestion · Airbus", pages: ["/candidatures/a1"], untrusted: true });
    expect(slowRead()).toMatchObject({ kind: "read", group: "applications", copiesText: false });
  });

  it("another Candidate's Application is not found", async () => {
    expect(await slowRead().run({ id: "a1", ms: 0 }, { candidateId: "paul", language: "fr" })).toEqual({ ok: false, error: "not_found" });
  });
});
