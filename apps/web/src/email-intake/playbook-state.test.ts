import { createI18n } from "@jobhub/shared/i18n";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoachingPlaybooks, migrateCoachingPlaybooks } from "../coaching-playbooks";
import { importedPlaybooks } from "../coaching-playbooks/import";
import { playbookServing } from "../coaching-playbooks/serving";
import { servedTasks } from "../task-playbooks/test-support";
import { createThrowawayDatabase, type ThrowawayDatabase } from "../test-support/throwaway-database";
import { emailIntakeHeldBack } from "./playbook-state";

const connectionString = process.env.DATABASE_URL;

describe("Email intake held back by its Task Playbook (ADR-0052)", () => {
  it("counts as off while no version of « Lire un email d'offres d'emploi » is served, or it cannot be read", async () => {
    expect(await emailIntakeHeldBack(servedTasks({}))).toBe("playbook_pending");
    expect(await emailIntakeHeldBack(async () => Promise.reject(new Error("database down")))).toBe("playbook_pending");
    expect(await emailIntakeHeldBack(servedTasks({ "job-offer-email-reading": { content: "- lis le mail" } }))).toBeNull();
  });

  it("names why on the Sources tab: en attente de validation du playbook", () => {
    expect(createI18n("fr").t("admin.platformSettings.sources.reasons.playbook_pending")).toBe("Indisponible : en attente de validation du playbook");
    expect(createI18n("en").t("admin.platformSettings.sources.reasons.playbook_pending")).toBe("Unavailable: awaiting validation of the playbook");
  });
});

describe.skipIf(!connectionString)("Email intake's Task Playbook as imported (needs Postgres: DATABASE_URL)", () => {
  let throwaway: ThrowawayDatabase;
  const reader = (env: Record<string, string>) => {
    const playbooks = createCoachingPlaybooks(throwaway.pool, { serving: playbookServing(env), agentModels: () => [], evalRunOn: async () => true });
    return Object.assign((id: string) => playbooks.servedTask(id), { playbooks });
  };

  beforeEach(async () => {
    throwaway = await createThrowawayDatabase("test_email_intake_playbook");
    await migrateCoachingPlaybooks(throwaway.pool, () => importedPlaybooks({}));
  }, 60_000);
  afterEach(async () => {
    await throwaway.drop();
  }, 60_000);

  it("with JOBHUB_TARGET=production and no validated version, reads « en attente de validation »; runs once a person validates it", async () => {
    const production = reader({ NODE_ENV: "production", JOBHUB_TARGET: "production" });
    const reason = (await emailIntakeHeldBack(production))!;

    expect(reason).toBe("playbook_pending");
    expect(createI18n("fr").t(`admin.platformSettings.sources.reasons.${reason}`)).toMatch(/en attente de validation/);

    await production.playbooks.validate({ email: "paul@jobbbox.fr", name: "Paul Martin" }, "job-offer-email-reading", 1);
    expect(await emailIntakeHeldBack(production)).toBeNull();
  });

  it("runs on the latest version elsewhere (staging)", async () => {
    expect(await emailIntakeHeldBack(reader({ NODE_ENV: "production", JOBHUB_TARGET: "staging" }))).toBeNull();
  });
});
