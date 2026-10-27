import { describe, expect, it } from "vitest";
import type { CoachingPlaybook, PlaybookVersion } from "../coaching-playbooks";
import { aiTaskRoutes, playbookAgentChange, playbookAgentRows, routeChange, searchTaskRows, type PlaybookWithVersions } from "./ai-tasks";
import type { ProvidersState } from "./parametres";
import { snapshotOfSettings, type StoredPlatformSettings } from "./resolver";

/** Every text task on Mistral with its key, web search on Perplexity with its key: the e2e server's routes. */
const ENV = {
  AI_SCORING_PROVIDER: "mistral",
  AI_WRITING_PROVIDER: "mistral",
  AI_COACHING_PROVIDER: "mistral",
  AI_CV_PARSING_PROVIDER: "mistral",
  AI_OFFER_ANALYSIS_PROVIDER: "mistral",
  MISTRAL_API_KEY: "mk",
  PERPLEXITY_API_KEY: "pk",
};

const stateOf = (env: Record<string, string> = ENV, stored: StoredPlatformSettings = {}): ProvidersState => ({
  env,
  signInTypes: [],
  settings: snapshotOfSettings(env, stored),
  secrets: null,
});

const AT = new Date("2026-10-20T10:00:00Z");
const version = (playbookId: string, number: number, more: Partial<PlaybookVersion> = {}): PlaybookVersion => ({
  playbookId,
  version: number,
  content: `# ${playbookId}\nRègles v${number}`,
  agent: { provider: "mistral", model: "mistral-large-latest", effort: "medium", consultWhen: "Quand le CV est en jeu" },
  search: null,
  authors: ["claire@jobbbox.fr"],
  createdAt: AT,
  updatedAt: AT,
  validation: { name: "Claire", email: "claire@jobbbox.fr", at: AT },
  ...more,
});
const playbook = (id: string, kind: CoachingPlaybook["kind"], latest: PlaybookVersion, served: PlaybookVersion | null = latest, archived = false): CoachingPlaybook => ({
  id,
  kind,
  title: `Titre ${id}`,
  archived,
  latest,
  served,
});

describe("the AI tasks' routes on the IA tab (#402)", () => {
  it("lists each text task with its provider, model, the source of its provider setting and its personal data", () => {
    const routes = aiTaskRoutes(stateOf(ENV, { AI_SCORING_MODEL: { value: "mistral-small-latest", updatedBy: "claire@jobbbox.fr", updatedAt: AT } }));

    expect(routes.map((route) => route.task)).toEqual(["scoring", "writing", "coaching", "back_office_assistant", "guardrail", "eval", "cv_parsing", "offer_analysis", "job_titles"]);
    expect(routes.find((route) => route.task === "scoring")).toEqual({
      task: "scoring",
      providerSetting: "AI_SCORING_PROVIDER",
      modelSetting: "AI_SCORING_MODEL",
      provider: "mistral",
      model: "mistral-small-latest",
      source: { kind: "setting", name: "AI_SCORING_PROVIDER", source: "env" },
      personalData: true,
      keyMissing: false,
    });
    // Job titles take the Job Offer analysis' provider: nothing of their own, so the code's default.
    expect(routes.find((route) => route.task === "job_titles")).toMatchObject({ provider: "mistral", source: { source: "default" }, personalData: false });
  });

  it("says which route's provider has no key", () => {
    const routes = aiTaskRoutes(stateOf(ENV, { AI_JOB_TITLES_PROVIDER: { value: "openai", updatedBy: "claire@jobbbox.fr", updatedAt: AT } }));

    expect(routes.find((route) => route.task === "job_titles")).toMatchObject({ provider: "openai", keyMissing: true, source: { source: "back_office" } });
    expect(routes.find((route) => route.task === "scoring")).toMatchObject({ keyMissing: false });
  });
});

describe("a route change, as the Platform Settings it saves (#402)", () => {
  it("saves the provider, the model left to it; the old model restored first", () => {
    expect(routeChange("job_titles", { provider: "mistral", model: "mistral-small-latest" }, { provider: "openai", model: "" })).toEqual([
      { name: "AI_JOB_TITLES_MODEL", value: null },
      { name: "AI_JOB_TITLES_PROVIDER", value: "openai" },
    ]);
  });

  it("saves the provider then its model", () => {
    expect(routeChange("job_titles", { provider: "mistral", model: null }, { provider: "openai", model: " gpt-5 " })).toEqual([
      { name: "AI_JOB_TITLES_PROVIDER", value: "openai" },
      { name: "AI_JOB_TITLES_MODEL", value: "gpt-5" },
    ]);
  });

  it("saves the model alone, or nothing when nothing changed", () => {
    expect(routeChange("scoring", { provider: "mistral", model: null }, { provider: "mistral", model: "mistral-large-latest" })).toEqual([{ name: "AI_SCORING_MODEL", value: "mistral-large-latest" }]);
    expect(routeChange("scoring", { provider: "mistral", model: "mistral-large-latest" }, { provider: "mistral", model: "" })).toEqual([{ name: "AI_SCORING_MODEL", value: null }]);
    expect(routeChange("scoring", { provider: "mistral", model: "mistral-large-latest" }, { provider: "mistral", model: "mistral-large-latest" })).toEqual([]);
  });
});

describe("the Playbook Agents on the IA tab (#402)", () => {
  const validated = version("cv-strategy", 1);
  const draft = version("cv-strategy", 2, { agent: { ...validated.agent!, model: "mistral-small-latest" }, validation: null });

  it("lists every Coaching Playbook in use, then each task Playbook with a Playbook Agent, never one archived or with none", () => {
    const rows = playbookAgentRows(
      [
        { playbook: playbook("job-search-queries", "task", version("job-search-queries", 1)), validated: version("job-search-queries", 1) },
        { playbook: playbook("company-news-search", "task", version("company-news-search", 1, { agent: null })), validated: null },
        { playbook: playbook("cv-strategy", "playbook", validated), validated },
        { playbook: playbook("old-advice", "playbook", version("old-advice", 1), null, true), validated: null },
        { playbook: playbook("core-digest", "core_digest", version("core-digest", 1, { agent: null })), validated: null },
      ],
      stateOf(),
    );

    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ["cv-strategy", "playbook"],
      ["job-search-queries", "task"],
    ]);
    expect(rows[1]).toMatchObject({ searches: true, keyMissing: false });
  });

  it("shows the served version's agent, the validated one production serves, and the draft waiting for its validation", () => {
    // In an environment serving the latest version, the draft is served; production still serves version 1.
    const [row] = playbookAgentRows([{ playbook: playbook("cv-strategy", "playbook", draft, draft), validated }], stateOf());

    expect(row).toMatchObject({ served: draft, validated, draft, agent: draft.agent });
  });

  it("has no draft when the latest version is validated", () => {
    const [row] = playbookAgentRows([{ playbook: playbook("cv-strategy", "playbook", validated), validated }], stateOf());

    expect(row!.draft).toBeNull();
  });

  it("says when the agent's provider has no key", () => {
    const onOpenAi = version("cv-strategy", 1, { agent: { provider: "openai", model: "gpt-5", effort: "low", consultWhen: "x" } });

    expect(playbookAgentRows([{ playbook: playbook("cv-strategy", "playbook", onOpenAi), validated: onOpenAi }], stateOf())[0]).toMatchObject({ keyMissing: true });
  });
});

describe("the search tasks on the Recherche web tab (#386, #402)", () => {
  const withVersions = (list: CoachingPlaybook[]): PlaybookWithVersions[] => list.map((each) => ({ playbook: each, validated: each.served }));

  it("lists the four search task Playbooks, each on its served Playbook Agent or search provider, else its AI task's route", () => {
    const rows = searchTaskRows(
      withVersions([
        playbook("job-search-queries", "task", version("job-search-queries", 3, { agent: { provider: "mistral", model: "mistral-small-latest", effort: null, consultWhen: "" } })),
        playbook("company-news-search", "task", version("company-news-search", 2, { agent: null, search: { provider: "brave", model: null } })),
      ]),
      stateOf(),
    );

    expect(rows.map((row) => ({ id: row.id, provider: row.provider, model: row.model, effort: row.effort, source: row.source, keyMissing: row.keyMissing }))).toEqual([
      { id: "job-search-queries", provider: "mistral", model: "mistral-small-latest", effort: null, source: { kind: "playbook", version: 3 }, keyMissing: false },
      { id: "job-offer-reading", provider: "mistral", model: null, effort: null, source: { kind: "setting", name: "AI_OFFER_ANALYSIS_PROVIDER", source: "env" }, keyMissing: false },
      // Company facts are read by its Playbook Agent (#405): with none served, its AI task's route.
      { id: "company-facts-search", provider: "mistral", model: null, effort: null, source: { kind: "setting", name: "AI_OFFER_ANALYSIS_PROVIDER", source: "env" }, keyMissing: false },
      // Brave named by its served version, and its key not entered.
      { id: "company-news-search", provider: "brave", model: null, effort: null, source: { kind: "playbook", version: 2 }, keyMissing: true },
    ]);
    expect(rows[0]!.playbook).toMatchObject({ id: "job-search-queries", searches: true });
    expect(rows[1]!.playbook).toBeNull();
  });
});

describe("a Playbook Agent changed on Paramètres (#402)", () => {
  const latest = version("cv-strategy", 1);

  it("keeps the version's rules and « when to consult it », with the model and effort chosen", () => {
    expect(playbookAgentChange(latest, { agentModel: "mistral|mistral-small-latest", effort: "high" })).toEqual({
      content: latest.content,
      provider: "mistral",
      model: "mistral-small-latest",
      effort: "high",
      consultWhen: "Quand le CV est en jeu",
      searchProvider: "",
      searchModel: "",
    });
  });

  it("keeps what the form does not change: the agent's effort, a task Playbook's web search provider", () => {
    const task = version("job-search-queries", 2, { agent: { provider: "mistral", model: null, effort: null, consultWhen: "" }, search: { provider: "brave", model: null } });

    expect(playbookAgentChange(task, { agentModel: "mistral|mistral-large-latest" })).toMatchObject({ model: "mistral-large-latest", effort: "", searchProvider: "brave", searchModel: "" });
    expect(playbookAgentChange(task, { searchModel: "" })).toMatchObject({ provider: "mistral", model: "", searchProvider: "", searchModel: "" });
  });
});
