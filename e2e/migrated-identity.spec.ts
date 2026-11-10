import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #918: an account that existed before « Identité » (a Master CV « DUPONT Marie », no names) arrives, after
// `npm run db:migrate`, with Prénom Marie, Nom Dupont and Preferred Name Marie; running it again changes nothing.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const identity = fr.account.identity;
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;

const masterCv = {
  fullName: "DUPONT Marie",
  headline: "Directrice financière",
  email: "m.dupont@perso.example",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [],
  education: [],
  skills: [],
  languages: [],
};

function migrate() {
  const result = spawnSync("npm", ["run", "db:migrate"], { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

async function sql<Row extends object = object>(statement: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<Row>(statement, values)).rows;
  } finally {
    await client.end();
  }
}

test("an existing account « DUPONT Marie » (CV alone) arrives with Marie, Dupont, Marie; the migration run again changes nothing (#918)", async ({ page }) => {
  await signInWithMagicLink(page, newAddress("identite-reprise"));
  const profile = await page.request.post("/api/profiles", { data: { masterCv, searchCriteria: { targetRole: "DAF", locations: ["Lyon"] } }, headers: { origin } });
  expect(profile.status(), await profile.text()).toBe(201);
  const { id } = (await (await page.request.get("/api/auth/get-session")).json()).user as { id: string };

  // The account as it was before this deployment: no names, an empty account name, and the one-time fill not yet run.
  await sql(`UPDATE candidate SET given_name = NULL, family_name = NULL, preferred_name = NULL, name = '' WHERE id = $1`, [id]);
  await sql(`DELETE FROM identity_names_backfill`);

  migrate();

  const names = async () => (await sql(`SELECT name, given_name AS "givenName", family_name AS "familyName", preferred_name AS "preferredName" FROM candidate WHERE id = $1`, [id]))[0];
  expect(await names()).toEqual({ name: "Marie Dupont", givenName: "Marie", familyName: "Dupont", preferredName: "Marie" });

  // What the Candidate sees in Mon compte › Identité.
  await page.goto("/compte/identite");
  const section = page.getByRole("region", { name: fr.account.sections.identity });
  await expect(section.getByRole("textbox", { name: identity.givenName, exact: true })).toHaveValue("Marie");
  await expect(section.getByRole("textbox", { name: identity.familyName, exact: true })).toHaveValue("Dupont");
  await expect(section.getByRole("textbox", { name: identity.preferredName, exact: true })).toHaveValue("Marie");

  // Run again (the next deployment): nothing changes, and a Preferred Name the Candidate cleared stays cleared.
  migrate();
  expect(await names()).toEqual({ name: "Marie Dupont", givenName: "Marie", familyName: "Dupont", preferredName: "Marie" });
  await sql(`UPDATE candidate SET preferred_name = NULL WHERE id = $1`, [id]);
  migrate();
  expect((await names()).preferredName).toBeNull();
});
