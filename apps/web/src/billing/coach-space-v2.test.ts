import { describe, expect, it } from "vitest";
import { coachingPaidQuery } from "./index";

describe("where Stripe sends a Candidate back from a paid Coaching Session (« Espace coach v2 », ADR-0106)", () => {
  it("off: « /coachs?session=paid », as on main", () => expect(coachingPaidQuery(false)).toBe("?session=paid"));
  it("on: with the Checkout's id", () => expect(coachingPaidQuery(true)).toBe("?session=paid&checkout_id={CHECKOUT_SESSION_ID}"));
});
