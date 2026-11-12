import { JOBBBOX_SELLER, type CoachingSeller } from "@jobhub/shared/coaching-offers";
import { describe, expect, it } from "vitest";
import { orderConfirmationEmail, type OrderConfirmation } from "./email";

const at = new Date("2026-10-15T08:00:00Z");
const session: OrderConfirmation = {
  kind: "coachingSession",
  subject: "Sophie Martin",
  paidAt: at,
  paid: { amount: 9000, currency: "eur" },
  price: null,
  cgv: null,
  immediateExecutionRequested: false,
  withdrawal: { url: "https://app.jobbbox.fr/agenda", until: at },
};
const coach: CoachingSeller = { id: "seller-1", kind: "human_coach", name: "Sophie Martin EI", status: "EI", siret: "12345678900011" };

describe("the Order Confirmation's seller (« Espace coach v2 », ADR-0107)", () => {
  it("off: says no seller, as before the Human Coach epic, whatever seller it is given; nor without a seller", () => {
    const before = orderConfirmationEmail(session, "en");
    expect(before.text).not.toContain("Sold by");
    for (const seller of [JOBBBOX_SELLER, coach]) {
      const email = orderConfirmationEmail({ ...session, seller, coachSpaceV2: false }, "en");
      expect(email).toEqual(before);
    }
  });

  it("on (or a seller given without the flag): says who sold the session, and the marketplace for a Coach's", () => {
    expect(orderConfirmationEmail({ ...session, seller: JOBBBOX_SELLER, coachSpaceV2: true }, "en").text).toContain("Sold by Jobbbox");
    expect(orderConfirmationEmail({ ...session, seller: JOBBBOX_SELLER }, "en").text).toContain("Sold by Jobbbox");
    const text = orderConfirmationEmail({ ...session, seller: coach, coachSpaceV2: true }, "en").text;
    expect(text).toContain("Sold by Sophie Martin EI");
    expect(text).toContain("SIRET 12345678900011");
    expect(text).toContain("Jobbbox is the marketplace");
  });
});
