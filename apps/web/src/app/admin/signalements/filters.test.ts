import { describe, expect, it } from "vitest";
import { signalementsFilter } from "./filters";

describe("the Signalements page's filters (#376)", () => {
  it("are « à traiter » (nouveau and vu) of every type by default", () => {
    expect(signalementsFilter({})).toEqual({ status: undefined, statuses: ["nouveau", "vu"] });
  });

  it("take one type, one status, or every status", () => {
    expect(signalementsFilter({ type: "question", statut: "traite" })).toEqual({ type: "question", status: "traite", statuses: ["traite"] });
    expect(signalementsFilter({ statut: "tous" })).toEqual({ status: "tous", statuses: ["nouveau", "vu", "traite"] });
  });

  it("ignore what is not a type or a status", () => {
    expect(signalementsFilter({ type: "plainte", statut: "supprime" })).toEqual({ status: undefined, statuses: ["nouveau", "vu"] });
  });
});
