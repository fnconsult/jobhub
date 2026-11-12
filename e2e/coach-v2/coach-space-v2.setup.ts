import pg from "pg";
import { test as setup } from "@playwright/test";

// « Espace coach v2 » (ADR-0106) on for the coach-v2 project: the Human Coach epic's specs run against the new workspace
// and marketplace. Every other project runs with it off, as a deployment does until #888. The setting is global to the
// suite's database: CI runs this project in a shard of its own, and the project depends on every web spec when run locally.
setup("turns « Espace coach v2 » on", async () => {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO platform_setting (name, value, updated_by_email) VALUES ('COACH_SPACE_V2', 'true', 'e2e@jobbbox.ai')
       ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()`,
    );
    await client.query("SELECT pg_notify('platform_settings_changed', '')");
  } finally {
    await client.end();
  }
  // The server reads the change on its notification: give it a moment, then check it is on.
  await setup.step("the server has it on", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  });
});
