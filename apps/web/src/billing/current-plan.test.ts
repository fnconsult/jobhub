import { describe, expect, it } from "vitest";
import { currentPlanLabel } from "./current-plan";

const PREMIUM = { fr: "Premium", en: "Premium" };

describe("the current Plan on the subscription page", () => {
  it("names the Plan of a subscription that renews", () => {
    expect(currentPlanLabel({ planName: PREMIUM, endsAt: null }, "fr")).toBe("Votre offre actuelle : Premium");
    expect(currentPlanLabel({ planName: { fr: "Gratuite", en: "Free" }, endsAt: null }, "fr")).toBe("Votre offre actuelle : Gratuite");
  });

  it("names it as Administrators named it, in the Candidate's language", () => {
    expect(currentPlanLabel({ planName: { fr: "Essentiel", en: "Essential" }, endsAt: null }, "en")).toBe("Your current Plan: Essential");
  });

  it("says until when a Plan whose cancellation is scheduled is kept", () => {
    const endsAt = new Date("2026-11-15T09:00:00Z");

    expect(currentPlanLabel({ planName: PREMIUM, endsAt }, "fr")).toBe("Votre offre actuelle : Premium jusqu'au 15 novembre 2026");
    expect(currentPlanLabel({ planName: { fr: "Standard", en: "Standard" }, endsAt }, "en")).toBe("Your current Plan: Standard until November 15, 2026");
  });

  it("dates the end in French time", () => {
    // 00:30 on 15 November in Paris.
    expect(currentPlanLabel({ planName: PREMIUM, endsAt: new Date("2026-11-14T23:30:00Z") }, "fr")).toBe("Votre offre actuelle : Premium jusqu'au 15 novembre 2026");
  });
});
