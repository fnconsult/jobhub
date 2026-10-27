import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";

// Issue #402 (ADR-0042): Paramètres' Recherche web tab lists the web search's bounded settings and « Tâches IA de la
// recherche »; the IA tab lists every AI task's route and every Playbook Agent, each changed in a side panel. A route
// is a Platform Setting, applied from the next call: a provider whose key is missing is warned of, and saved all the
// same. A Playbook Agent belongs to its Playbook Version: changing its model makes a draft version to validate in
// Playbooks, and the version served in production (the validated one) is unchanged. The e2e server has Mistral's key,
// never OpenAI's (playwright.config.ts).
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const admin = fr.admin;
const texts = admin.platformSettings;
const ai = texts.aiTasks;
const playbooks = admin.coachingPlaybooks;
const databaseUrl = process.env.E2E_DATABASE_URL!;
// Its own permanent super-admin (playwright.config.ts): a super-admin is a Playbook editor too.
const SUPER_ADMIN = "ai-tasks-office@e2e.jobbbox.test";
const PATH = "/admin/parametres";

const tr = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

test.describe("AI tasks and Playbook Agents on Paramètres (#402)", () => {
  test("Recherche web shows the web search's bounded settings and the search AI tasks, each with provider, model, effort, source and key", async ({ page }) => {
    await signInWithMagicLink(page, SUPER_ADMIN);
    await page.goto(`${PATH}?tab=recherche-web`);

    for (const name of ["JOB_DISCOVERY_COUNTRY", "JOB_DISCOVERY_MAX_POSTING_AGE_DAYS", "JOB_DISCOVERY_RESULTS_PER_QUERY", "JOB_DISCOVERY_TITLES_PER_LANGUAGE", "JOB_DISCOVERY_QUERY_LANGUAGES", "JOB_DISCOVERY_TARGET_COMPANIES_PER_RUN", "JOB_DISCOVERY_COMPANY_REVISIT_DAYS", "WEB_SEARCH_MONTHLY_ALERT_EUR"]) {
      await expect(page.locator(`tr[data-setting="${name}"]`), name).toBeVisible();
    }
    await expect(page.locator('tr[data-setting="JOB_DISCOVERY_COUNTRY"]').getByRole("cell").nth(0)).toHaveText("FR");

    const tasks = page.getByRole("table", { name: ai.searchTitle });
    await expect(tasks.locator("tr[data-search-task]")).toHaveCount(4);
    // The job title variants on their imported Playbook Agent: Mistral, the e2e server's route, its key entered.
    const queries = tasks.locator('tr[data-search-task="job-search-queries"]');
    await expect(queries).toContainText(ai.roles["job-search-queries"]);
    await expect(queries).toContainText(`Mistral AI · ${ai.providerDefault}`);
    await expect(queries).toContainText(tr(ai.sourcePlaybook, { version: "1" }));
    await expect(queries).toContainText(ai.keySet);
    // A Company Dossier's news: the active Search provider, Perplexity.
    await expect(tasks.locator('tr[data-search-task="company-news-search"]')).toContainText("Perplexity");
  });

  test.describe("a Playbook Agent changed in the side panel", () => {
    const id = `e2e-agent-${unique()}`;
    const title = `Playbook de l'e2e #402 ${id}`;

    // A Coaching Playbook whose version 1 is Human-validated: what production serves.
    test.beforeAll(async () => {
      await sql("INSERT INTO coaching_playbook (id, kind) VALUES ($1, 'playbook')", [id]);
      await sql(
        `INSERT INTO playbook_version (playbook_id, version, content, agent_provider, agent_model, agent_effort, consult_when, authors, validated_by_name, validated_by_email, validated_at)
         VALUES ($1, 1, $2, 'mistral', NULL, 'medium', 'Jamais : un playbook de test', ARRAY['import'], 'Valérie Validatrice', 'validatrice@e2e.jobbbox.test', now())`,
        [id, `# ${title}\n\n- Une règle de test.`],
      );
    });

    // Never served to the AI Coach of the other specs.
    test.afterAll(async () => {
      await sql("UPDATE coaching_playbook SET archived_at = now() WHERE id = $1", [id]);
    });

    test("changing a Playbook Agent's model from the side panel creates a draft version; the served one is unchanged", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(`${PATH}?tab=ia`);
      const row = page.locator(`tr[data-playbook-agent="${id}"]`);
      await expect(row).toContainText(`Mistral AI · ${ai.providerDefault}`);
      await expect(row).toContainText(tr(ai.validatedVersion, { version: "1" }));

      await row.getByRole("link", { name: tr(ai.editLabel, { name: title }) }).click();
      const panel = page.getByRole("complementary", { name: title });
      await expect(panel).toContainText(tr(ai.playbookPanel.createsDraft, { version: "2" }));
      await panel.getByLabel(ai.playbookPanel.model).selectOption("mistral|mistral-small-latest");
      await panel.getByRole("button", { name: tr(ai.playbookPanel.create, { version: "2" }) }).click();

      await expect(panel.getByRole("status")).toHaveText(tr(ai.agentNotices.created, { version: "2" }));
      await expect(panel.getByRole("link", { name: ai.playbookPanel.open })).toHaveAttribute("href", `/admin/playbooks/${id}`);
      // Production still serves version 1; version 2 waits for its validation in Playbooks.
      await page.goto(`${PATH}?tab=ia`);
      await expect(row).toContainText(tr(ai.validatedVersion, { version: "1" }));
      await expect(row).toContainText(tr(ai.draftVersion, { version: "2" }));

      // In Playbooks: version 1 as it was, validated; version 2 with the new model, not validated.
      await page.goto(`/admin/playbooks/${id}?version=1`);
      const version = page.getByRole("region", { name: tr(playbooks.detail.versionTitle, { version: "1" }) });
      await expect(version).toContainText(tr(playbooks.agentSummary, { provider: "mistral", model: playbooks.providerDefault, effort: playbooks.efforts.medium }));
      await expect(version).toContainText("Valérie Validatrice");
      await page.goto(`/admin/playbooks/${id}?version=2`);
      const draft = page.getByRole("region", { name: tr(playbooks.detail.versionTitle, { version: "2" }) });
      await expect(draft).toContainText(tr(playbooks.agentSummary, { provider: "mistral", model: "mistral-small-latest", effort: playbooks.efforts.medium }));
      await expect(draft).toContainText(playbooks.notValidated);
      // The rules are the validated version's, as they were.
      const [v1, v2] = await sql<{ content: string }>("SELECT content FROM playbook_version WHERE playbook_id = $1 ORDER BY version", [id]);
      expect(v2!.content).toBe(v1!.content);
    });
  });

  test.describe("an AI task's route changed in the side panel", () => {
    // Whatever happens, the other specs find the Eval Runs' judge where env and the code leave it.
    test.afterAll(async () => {
      await sql("DELETE FROM platform_setting WHERE name = ANY($1::text[])", [["AI_EVAL_PROVIDER", "AI_EVAL_MODEL"]]);
      await sql("SELECT pg_notify('platform_settings_changed', '')");
    });

    test("Missing-key warning shown, save allowed", async ({ page }) => {
      await signInWithMagicLink(page, SUPER_ADMIN);
      await page.goto(`${PATH}?tab=ia`);
      const row = page.locator('tr[data-ai-task="eval"]');
      await expect(row).toContainText(ai.keySet);
      await row.getByRole("link", { name: tr(ai.editLabel, { name: admin.aiUsage.tasks.eval }) }).click();

      const panel = page.getByRole("complementary", { name: admin.aiUsage.tasks.eval });
      const provider = panel.getByLabel(ai.routePanel.provider);
      // OpenAI has no key here: offered all the same, said so.
      await expect(provider.locator('option[value="openai"]')).toContainText(ai.noKeyOption);
      await provider.selectOption("openai");
      await panel.getByRole("button", { name: texts.save }).click();

      await expect(panel.getByRole("status").filter({ hasText: ai.notices.routeSaved })).toBeVisible();
      await expect(panel.locator("[data-key-warning]")).toHaveText(tr(ai.keyWarning, { provider: "OpenAI" }));
      await page.goto(`${PATH}?tab=ia`);
      await expect(row).toContainText("OpenAI");
      await expect(row).toContainText(ai.keyMissing);
      await expect(row).toContainText(texts.sources.back_office);

      // « Rétablir le défaut »: back to the Évaluations' default route, its key entered.
      await row.getByRole("link", { name: tr(ai.editLabel, { name: admin.aiUsage.tasks.eval }) }).click();
      await panel.getByRole("button", { name: ai.routePanel.restore }).click();
      await expect(panel.getByRole("status").filter({ hasText: ai.notices.routeRestored })).toBeVisible();
      await expect(panel.locator("[data-key-warning]")).toHaveCount(0);
    });
  });
});
