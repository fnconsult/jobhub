import pg from "pg";
import { test as teardown } from "@playwright/test";

// « Espace coach v2 » back to its default (off) after the coach-v2 project, for any project run after it.
teardown("turns « Espace coach v2 » off again", async () => {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query("DELETE FROM platform_setting WHERE name = 'COACH_SPACE_V2'");
    await client.query("SELECT pg_notify('platform_settings_changed', '')");
  } finally {
    await client.end();
  }
});
