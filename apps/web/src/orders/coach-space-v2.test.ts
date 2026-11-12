import { JOBBBOX_SELLER } from "@jobhub/shared/coaching-offers";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createOrders, type OrdersDeps } from "./index";

const COACH = { id: "coach-1", name: "Camille Martin" };
const SALE = { offerId: "offer-1", coachId: COACH.id, seller: JOBBBOX_SELLER, durationMinutes: 60, amount: 12000, currency: "eur", commissionBps: 0 };
const ITEM = { kind: "coachingSession", coachId: COACH.id, remedyId: "remedy-1" } as const;

/** Orders without a database: the Order page's terms are read from the deps only. */
function ordersWith(coachSpaceV2: boolean) {
  const peerOrderCap = vi.fn(async () => ({ amount: 20000, currency: "eur" }));
  const deps = {
    billing: { coachingSessionPrice: async () => ({ amount: 9000, currency: "eur", regularAmount: 9000, planName: { fr: "Essentiel", en: "Essential" } }) },
    coaches: { list: async () => [COACH] },
    offers: { sale: async () => SALE, quote: async () => ({ id: "quote-1", sale: SALE }) },
    peerOrderCap,
    acceptances: {},
    mailer: { send: async () => {} },
    baseURL: "https://app.jobbbox.fr",
    registry: () => [],
    coachSpaceV2: () => coachSpaceV2,
  } as unknown as OrdersDeps;
  return { orders: createOrders({} as Pool, deps), peerOrderCap };
}

describe("ordering a Coaching Session behind « Espace coach v2 » (ADR-0106)", () => {
  it("off: at the Plan's price, with no Coaching Offer, seller or Peer remedy, as on main", async () => {
    const { orders, peerOrderCap } = ordersWith(false);
    const terms = await orders.terms("candidate-1", ITEM);
    expect(terms?.summary).toEqual({ kind: "coachingSession", subject: { fr: COACH.name, en: COACH.name }, price: { amount: 9000, currency: "eur", interval: null } });
    expect(peerOrderCap).not.toHaveBeenCalled();
  });

  it("on: at the Coaching Offer's price, with its seller", async () => {
    const { orders, peerOrderCap } = ordersWith(true);
    const terms = await orders.terms("candidate-1", ITEM);
    expect(terms?.summary).toMatchObject({ price: { amount: 12000, currency: "eur", interval: null }, sale: SALE });
    expect(peerOrderCap).toHaveBeenCalled();
  });
});
