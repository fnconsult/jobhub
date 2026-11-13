import { it, expect } from "vitest";
import { taxQuarters, taxIdentitySchema } from "./model";
it("reports one personal service without a goods threshold and reconciles its remittance separately", () => {
  const quarters = taxQuarters(
    2026,
    [{ id: "charge-1", at: new Date("2026-12-31T22:59:59Z"), consideration: 7200, fees: 1800, activities: 1, currency: "eur" }],
    [{ at: new Date("2027-02-01T12:00Z"), amount: 7200, currency: "eur" }],
  );
  expect(quarters[3]).toEqual({ quarter: 4, consideration: 7200, fees: 1800, taxes: 0, activities: 1, bankPayouts: 0 });
  expect(taxQuarters(2027, [], [{ at: new Date("2027-02-01T12:00Z"), amount: 7200, currency: "eur" }])[0]!.bankPayouts).toBe(7200);
});
it("blocks duplicate resources and negative cross-period totals instead of silently changing a return", () => {
  const event = { id: "refund-1", at: new Date("2026-03-01T12:00Z"), consideration: -9000, fees: 0, activities: 0, currency: "eur" };
  expect(() => taxQuarters(2026, [event], [])).toThrow();
  expect(() =>
    taxQuarters(
      2026,
      [
        { ...event, consideration: 9000 },
        { ...event, consideration: 9000 },
      ],
      [],
    ),
  ).toThrow();
});
it("collects professional individual identity and validates account checksum", () => {
  const input = {
    kind: "individual",
    legalName: "Test business",
    firstName: "Test",
    lastName: "Owner",
    birthDate: "1980-01-01",
    residence: "FR",
    tin: "12345678900011",
    tinCountry: "FR",
    siret: "12345678900011",
    street: "1 rue Exemple",
    postalCode: "75001",
    city: "Paris",
    addressCountry: "FR",
    iban: "FR7630006000011234567890189",
    accountHolder: "Test Owner",
  };
  expect(taxIdentitySchema.safeParse(input).success).toBe(true);
  expect(taxIdentitySchema.safeParse({ ...input, birthDate: undefined }).success).toBe(false);
  expect(taxIdentitySchema.safeParse({ ...input, iban: "FR7630006000011234567890180" }).success).toBe(false);
});
