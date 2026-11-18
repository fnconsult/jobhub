import { describe, expect, it } from "vitest";
import type { EntryOffer } from "@/ai-activity/entries";
import { firstOffers, FIRST_OFFERS_SHOWN, profileBuilding } from "./index";

const offer = (score: number, title = `Offre ${score}`): EntryOffer => ({ title, employer: "Groupe Ferlac", location: "Lyon", score, href: `/recherches/s/offres/${score}` });

describe("The first offers card on a phone (#1051)", () => {
  it("lists none when no Job Offer reaches the Match Score threshold", () => {
    expect(firstOffers([offer(59), offer(12)])).toEqual([]);
  });

  it("lists up to 3 of those at the threshold or above, the best first", () => {
    const shown = firstOffers([offer(70), offer(91), offer(60), offer(85), offer(40)]);
    expect(FIRST_OFFERS_SHOWN).toBe(3);
    expect(shown.map((one) => one.score)).toEqual([91, 85, 70]);
  });
});

describe("The Profile in construction, beside the first welcome's conversation (#1051)", () => {
  it("knows nothing yet before the Candidate starts", () => {
    expect(profileBuilding({ creation: null, cvReading: false })).toEqual({ cv: "waiting", targetRole: null, locations: [] });
  });

  it("says the CV is being read, then read", () => {
    expect(profileBuilding({ creation: {}, cvReading: true }).cv).toBe("reading");
    expect(profileBuilding({ creation: { reading: { provenance: null } }, cvReading: false }).cv).toBe("read");
  });

  it("says there is no CV once the interview started without one", () => {
    expect(profileBuilding({ creation: { interview: { at: "2026-11-18T09:00:00Z", answered: 0, skipped: 0, provenance: null } }, cvReading: false }).cv).toBe("none");
  });

  it("fills the target role and places as they are answered or validated", () => {
    const building = profileBuilding({ creation: { building: { targetRole: "  Directrice financière ", locations: ["Lyon", "Villeurbanne"] } }, cvReading: false });
    expect(building).toMatchObject({ targetRole: "Directrice financière", locations: ["Lyon", "Villeurbanne"] });
    expect(profileBuilding({ creation: { building: { targetRole: " ", locations: [] } }, cvReading: false }).targetRole).toBeNull();
  });
});
