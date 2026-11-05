import { secondStepReadSchema } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { TwoStepFactor } from "./index";
import { secondStepRead } from "./pending-sessions";

const at = new Date("2026-11-04T10:00:00Z");
const APP: TwoStepFactor = { kind: "authenticator_app", addedAt: at, lastUsedAt: null };
const PASSKEY: TwoStepFactor = { kind: "passkey", id: "p1", name: "iPhone", device: null, addedAt: at, lastUsedAt: null };
const BACKUP: TwoStepFactor = { kind: "backup_codes", addedAt: at, lastUsedAt: null };
const pending = (step: "second_step" | "setup") => ({ sessionId: "s1", candidateId: "c1", step });

// What GET /api/two-step-verification/second-step answers (#688), and the second step's page shows.
describe("what a session has to do before anything else", () => {
  it("is its second step, with the account's passkey and authenticator app when it has them", () => {
    expect(secondStepRead(pending("second_step"), [APP, PASSKEY, BACKUP])).toEqual({ step: "second_step", passkey: true, app: true });
    expect(secondStepRead(pending("second_step"), [PASSKEY, BACKUP])).toEqual({ step: "second_step", passkey: true, app: false });
    expect(secondStepRead(pending("second_step"), [APP, BACKUP])).toEqual({ step: "second_step", passkey: false, app: true });
  });

  it("is the setup, for an account that must have it and has no factor yet, without naming any factor", () => {
    expect(secondStepRead(pending("setup"), [])).toEqual({ step: "setup" });
  });

  it("is nothing for a session not pending", () => {
    expect(secondStepRead(null, [APP])).toEqual({ step: null });
  });

  it("answers what the native app reads", () => {
    for (const read of [secondStepRead(pending("second_step"), [APP]), secondStepRead(pending("setup"), []), secondStepRead(null, [])]) {
      expect(secondStepReadSchema.parse(read)).toEqual(read);
    }
  });
});
