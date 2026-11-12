import { describe, expect, it } from "vitest";
import type { PlanCard } from "@/billing/plan-cards";
import { snapshotOfSettings } from "@/platform-settings/resolver";
import { humanCoachPathEnabled, landingPlans, landingStoreLinks } from "./index";

const setBy = { updatedBy: "ops@jobbbox.ai", updatedAt: new Date("2026-11-12T10:00:00Z") };

describe("the landing page's store links (ADR-0105)", () => {
  it("shows none while Paramètres sets none", () => {
    expect(landingStoreLinks(snapshotOfSettings({}, {}))).toEqual({ extension: null, appStore: null, playStore: null });
  });

  it("takes each store's page from Paramètres, the Back Office's over env's", () => {
    const settings = snapshotOfSettings(
      { APP_STORE_URL: "https://example.test/old", PLAY_STORE_URL: "https://play.google.com/store/apps/details?id=ai.jobbbox.app" },
      { APP_STORE_URL: { value: "https://apps.apple.com/fr/app/jobbbox/id0000000000", ...setBy }, EXTENSION_STORE_URL: { value: "https://chromewebstore.google.com/detail/jobbbox/abc", ...setBy } },
    );
    expect(landingStoreLinks(settings)).toEqual({
      extension: "https://chromewebstore.google.com/detail/jobbbox/abc",
      appStore: "https://apps.apple.com/fr/app/jobbbox/id0000000000",
      playStore: "https://play.google.com/store/apps/details?id=ai.jobbbox.app",
    });
  });

  it("shows no link to a page that is not an https URL", () => {
    expect(landingStoreLinks(snapshotOfSettings({ APP_STORE_URL: "http://apps.apple.com/app", PLAY_STORE_URL: "play store" }, {}))).toEqual({ extension: null, appStore: null, playStore: null });
  });
});

describe("the Human Coaches' path on the public site (ADR-0105)", () => {
  it("is off until Paramètres switches it on", () => {
    expect(humanCoachPathEnabled(snapshotOfSettings({}, {}))).toBe(false);
    expect(humanCoachPathEnabled(snapshotOfSettings({ HUMAN_COACH_PAGE_ENABLED: "false" }, {}))).toBe(false);
  });

  it("is on once the Back Office, or env, says so; the Back Office wins", () => {
    expect(humanCoachPathEnabled(snapshotOfSettings({ HUMAN_COACH_PAGE_ENABLED: "true" }, {}))).toBe(true);
    expect(humanCoachPathEnabled(snapshotOfSettings({ HUMAN_COACH_PAGE_ENABLED: "true" }, { HUMAN_COACH_PAGE_ENABLED: { value: "false", ...setBy } }))).toBe(false);
    expect(humanCoachPathEnabled(snapshotOfSettings({}, { HUMAN_COACH_PAGE_ENABLED: { value: "true", ...setBy } }))).toBe(true);
  });

  it("stays off on a value that is neither true nor false", () => {
    expect(humanCoachPathEnabled(snapshotOfSettings({ HUMAN_COACH_PAGE_ENABLED: "yes" }, {}))).toBe(false);
  });
});

describe("the landing page's Plans (ADR-0105)", () => {
  const card = (over: Partial<PlanCard>): PlanCard => ({ key: "free", name: "Gratuit", price: null, quotas: [], current: true, recommended: false, checkout: false, ...over }) as PlanCard;

  it("keeps each offered Plan's name, price and lines, in the catalogue's order, and nothing of a Candidate's", () => {
    const plans = landingPlans([
      card({ price: "0 € / mois", quotas: [{ quota: "profiles", label: "Profils", value: "1", included: true }] }),
      card({ key: "standard", name: "Standard", price: "19 € / mois", current: false, recommended: true, checkout: true, quotas: [{ quota: "jobDigest", label: "Job Digest", value: "Aucun", included: false }] }),
    ] as PlanCard[]);
    expect(plans).toEqual([
      { key: "free", name: "Gratuit", price: "0 € / mois", lines: [{ label: "Profils", value: "1", included: true }] },
      { key: "standard", name: "Standard", price: "19 € / mois", lines: [{ label: "Job Digest", value: "Aucun", included: false }] },
    ]);
  });

  it("shows no price when Stripe gave none", () => {
    expect(landingPlans([card({ key: "premium", name: "Premium" })])[0]!.price).toBeNull();
  });
});
