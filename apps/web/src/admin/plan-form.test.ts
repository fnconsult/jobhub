import { describe, expect, it } from "vitest";
import { planFromForm } from "./plan-form";

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

describe("the Plan form of the Back Office", () => {
  it("reads the names, the Stripe product, whether it is offered and the Plan Features ticked", () => {
    expect(
      planFromForm(
        form([
          ["key", "essentiel"],
          ["nameFr", "Essentiel"],
          ["nameEn", "Essential"],
          ["stripeProductId", " prod_essential "],
          ["offered", "on"],
          ["features", "coachingSessionDiscount"],
        ]),
      ),
    ).toEqual({ key: "essentiel", name: { fr: "Essentiel", en: "Essential" }, status: "offered", stripeProductId: "prod_essential", features: ["coachingSessionDiscount"] });
  });

  it("reads an unticked box as hidden and no feature, and no product as none", () => {
    expect(planFromForm(form([["nameFr", "Gratuite"], ["nameEn", "Free"]]))).toEqual({
      key: "",
      name: { fr: "Gratuite", en: "Free" },
      status: "hidden",
      stripeProductId: null,
      features: [],
    });
  });
});
