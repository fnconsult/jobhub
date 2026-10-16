import { describe, expect, it } from "vitest";
import { currentPlanLabel } from "./current-plan";

describe("the current Plan on the subscription page", () => {
  it("names the Plan of a subscription that renews", () => {
    expect(currentPlanLabel({ plan: "premium", endsAt: null }, "fr")).toBe("Votre offre actuelle : Premium");
    expect(currentPlanLabel({ plan: "free", endsAt: null }, "fr")).toBe("Votre offre actuelle : Gratuite");
  });

  it("says until when a Plan whose cancellation is scheduled is kept", () => {
    const endsAt = new Date("2026-11-15T09:00:00Z");

    expect(currentPlanLabel({ plan: "premium", endsAt }, "fr")).toBe("Votre offre actuelle : Premium jusqu'au 15 novembre 2026");
    expect(currentPlanLabel({ plan: "standard", endsAt }, "en")).toBe("Your current Plan: Standard until November 15, 2026");
  });

  it("dates the end in French time", () => {
    // 00:30 on 15 November in Paris.
    expect(currentPlanLabel({ plan: "premium", endsAt: new Date("2026-11-14T23:30:00Z") }, "fr")).toBe("Votre offre actuelle : Premium jusqu'au 15 novembre 2026");
  });
});
