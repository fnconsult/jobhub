import { coachingDay } from "@jobhub/shared/coaching-time";
import { z } from "zod";
const country = z.string().regex(/^[A-Z]{2}$/);
const text = z.string().trim().min(1).max(200);
export const taxIdentitySchema = z
  .object({
    kind: z.enum(["individual", "entity"]),
    legalName: text,
    firstName: z.string().trim().max(100).default(""),
    lastName: z.string().trim().max(100).default(""),
    birthDate: z.string().date().optional(),
    residence: country,
    tin: text,
    tinCountry: country,
    siret: z.string().regex(/^\d{14}$/),
    vat: z.string().trim().max(40).default(""),
    street: text,
    postalCode: text,
    city: text,
    addressCountry: country,
    iban: z
      .string()
      .transform((s) => s.replace(/\s/g, "").toUpperCase())
      .refine(validIban),
    accountHolder: text,
    permanentEstablishments: z.array(country).max(30).default([]),
  })
  .strict()
  .superRefine((x, ctx) => {
    if (x.kind === "individual" && (!x.firstName || !x.lastName || !x.birthDate)) ctx.addIssue({ code: "custom", message: "Individual identity incomplete" });
    if (x.tinCountry === "FR" && !/^\d{9}(\d{5})?$/.test(x.tin)) ctx.addIssue({ code: "custom", message: "French professional TIN required" });
    if (x.kind === "entity" && x.tinCountry === "FR" && x.tin !== x.siret && x.tin !== x.siret.slice(0, 9))
      ctx.addIssue({ code: "custom", message: "French entity TIN must identify the same SIREN/SIRET" });
    if (x.kind === "individual" && x.tinCountry === "FR" && x.tin !== x.siret)
      ctx.addIssue({ code: "custom", message: "French professional individual TIN must match SIRET" });
  });
export type TaxIdentity = z.infer<typeof taxIdentitySchema>;
export interface TaxEvent {
  observedAt?: Date;
  id: string;
  at: Date;
  consideration: number;
  fees: number;
  activities: number;
  currency: string;
}
export interface TaxQuarter {
  quarter: 1 | 2 | 3 | 4;
  consideration: number;
  fees: number;
  taxes: number;
  activities: number;
  bankPayouts: number;
}
export function taxQuarters(year: number, events: TaxEvent[], payouts: { at: Date; amount: number; currency: string }[]): TaxQuarter[] {
  if (!Number.isInteger(year) || year < 2026 || year > 9998) throw Error("Invalid reporting year");
  const quarters: TaxQuarter[] = [1, 2, 3, 4].map((quarter) => ({
    quarter: quarter as 1 | 2 | 3 | 4,
    consideration: 0,
    fees: 0,
    taxes: 0,
    activities: 0,
    bankPayouts: 0,
  }));
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) throw Error("Duplicate fiscal resource");
    seen.add(event.id);
    if (
      !Number.isFinite(+event.at) ||
      ![event.consideration, event.fees, event.activities].every(Number.isSafeInteger) ||
      event.currency.toLowerCase() !== "eur"
    )
      throw Error("Unreconciled fiscal resource");
    const day = coachingDay(event.at, "Europe/Paris");
    if (Number(day.slice(0, 4)) !== year) continue;
    const quarter = quarters[Math.floor((Number(day.slice(5, 7)) - 1) / 3)]!;
    quarter.consideration += event.consideration;
    quarter.fees += event.fees;
    quarter.activities += event.activities;
  }
  for (const payout of payouts) {
    if (!Number.isFinite(+payout.at) || !Number.isSafeInteger(payout.amount) || payout.currency.toLowerCase() !== "eur") throw Error("Unreconciled payout");
    const day = coachingDay(payout.at, "Europe/Paris");
    if (Number(day.slice(0, 4)) === year) quarters[Math.floor((Number(day.slice(5, 7)) - 1) / 3)]!.bankPayouts += payout.amount;
  }
  if (quarters.some((q) => !Object.values(q).every(Number.isSafeInteger) || q.consideration < 0 || q.fees < 0 || q.activities < 0))
    throw Error("A prior-period correction requires operator review");
  return quarters;
}
export function validIban(value: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  const digits = (value.slice(4) + value.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}
