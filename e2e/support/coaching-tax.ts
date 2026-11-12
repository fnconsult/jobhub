/** Synthetic fiscal identity for unrelated flow fixtures; never imported by the shipped app. */
import type { Pool } from "pg";
import { coachingTaxes } from "../../apps/web/src/coaching-tax";
import { secretCipherFromEnv } from "../../apps/web/src/provider-secrets/cipher";
export const FISCAL_TEST_KEY = "1:ZTJlLW9ubHktbWFzdGVyLWtleS1lMmUtb25seS0wMDA=";
export async function saveFiscalFixture(database: Pool, ownerId: string, sellerId: string) {
  const seller = (await database.query("SELECT name,siret,kind FROM coaching_seller WHERE id=$1", [sellerId])).rows[0];
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date()));
  const saved = await coachingTaxes(database, {
    cipher: secretCipherFromEnv({ SECRETS_MASTER_KEYS: FISCAL_TEST_KEY }),
    permitted: async () => true,
  }).saveIdentity(ownerId, sellerId, year, {
    kind: seller.kind === "association" ? "entity" : "individual",
    legalName: seller.name,
    firstName: "Synthetic",
    lastName: "Test",
    birthDate: "1980-01-01",
    residence: "FR",
    tin: seller.siret,
    tinCountry: "FR",
    siret: seller.siret,
    street: "1 rue Test",
    postalCode: "75001",
    city: "Paris",
    addressCountry: "FR",
    iban: "FR7630006000011234567890189",
    accountHolder: "Synthetic Test",
  });
  if (!saved) throw Error("Synthetic fiscal fixture rejected");
}
