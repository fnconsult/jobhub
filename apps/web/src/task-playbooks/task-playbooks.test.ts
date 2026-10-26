import { createAiLayer } from "@jobhub/ai";
import { createFakeProvider, createMemoryUsageLog } from "@jobhub/ai/testing";
import { builtInInstructions } from "@jobhub/coach-knowledge/tasks";
import { describe, expect, it } from "vitest";
import { readCvWithAi } from "../cv/ai-reading";
import { followUpDraft } from "../follow-ups/draft";
import { servedTaskRun, taskRun } from "./index";
import { servedTasks, taskAgent } from "./test-support";

function layer(reply = "{}") {
  const mistral = createFakeProvider({ id: "mistral", reply });
  const claude = createFakeProvider({ id: "anthropic", reply, models: ["claude-opus-5-5"] });
  const tavily = createFakeProvider({ id: "tavily", residency: "outside_eu", models: ["basic", "advanced"] });
  const usage = createMemoryUsageLog();
  const ai = createAiLayer({ providers: [mistral, claude, tavily], routes: { writing: "mistral", cv_parsing: "mistral", coaching: "mistral", web_search: "tavily" }, usage, warn: () => {} });
  return { ai, mistral, claude, usage };
}

const quiet = () => {};

describe("what an AI task runs with (ADR-0026)", () => {
  it("is its served version: its text, a section of it, and its Playbook Agent's route and effort", async () => {
    const { ai } = layer();
    const run = await taskRun(servedTasks({ "tailored-cv": { content: "## fr\n\nAdapte.\n\n## en\n\nAdapt.", agent: taskAgent("anthropic", "claude-opus-5-5", "high") } }), "tailored-cv", ai);

    expect(run.version).toBe(2);
    expect(run.text("en")).toBe("Adapt.");
    expect(run.agent).toEqual({ route: { provider: "anthropic", model: "claude-opus-5-5" }, effort: "high", warnings: [] });
    expect(run.instructions("fr")).toEqual({ text: "Adapte.", route: { provider: "anthropic", model: "claude-opus-5-5" }, effort: "high", warnings: [] });
  });

  it("is its built-in text on the task's configured route, with a warning, when no version is served or it cannot be read", async () => {
    const { ai } = layer();
    const warnings: string[] = [];

    const none = await taskRun(servedTasks({}), "cv-reading", ai, (message) => warnings.push(message));
    const failing = await taskRun(async () => Promise.reject(new Error("database down")), "cv-reading", ai, (message) => warnings.push(message));

    for (const run of [none, failing]) {
      expect(run).toMatchObject({ version: null, agent: { warnings: [expect.anything()] } });
      expect(run.agent).not.toHaveProperty("route");
      expect(run.text()).toBe(builtInInstructions("cv-reading"));
    }
    expect(warnings).toEqual([expect.stringMatching(/no version of task Playbook "cv-reading" is served/), expect.stringMatching(/could not be read: database down/)]);
  });

  it("leaves out, with a warning, a Playbook Agent the AI layer no longer offers, and a section the served text lacks", async () => {
    const { ai } = layer();
    const warnings: string[] = [];

    const run = await taskRun(servedTasks({ "tailored-cv": { content: "## fr\n\nAdapte.", agent: taskAgent("openai", "gpt-5") } }), "tailored-cv", ai, (message) => warnings.push(message));

    expect(run.agent).not.toHaveProperty("route");
    expect(run.text("en")).toBe(builtInInstructions("tailored-cv", "en"));
    expect(warnings).toHaveLength(2);
  });

  it("searches the web on the provider and model its served version names, else on the configured web-search route", async () => {
    const { ai } = layer();
    const facts = "Qui est {{entreprise}} ?";

    expect((await taskRun(servedTasks({ "company-facts-search": { content: facts, search: { provider: "tavily", model: "advanced" } } }), "company-facts-search", ai)).searchRoute).toEqual({ provider: "tavily", model: "advanced" });
    expect((await taskRun(servedTasks({ "company-facts-search": { content: facts, search: { provider: "tavily", model: null } } }), "company-facts-search", ai)).searchRoute).toEqual({ provider: "tavily" });
    expect((await taskRun(servedTasks({ "company-facts-search": { content: facts } }), "company-facts-search", ai)).searchRoute).toBeUndefined();
    expect((await taskRun(undefined, "company-facts-search", ai)).searchRoute).toBeUndefined();
  });

  it("leaves out, with a warning, a web-search provider the AI layer no longer offers: the configured route is used", async () => {
    const { ai } = layer();
    const warnings: string[] = [];
    const served = (search: { provider: "tavily" | "brave"; model: string | null }) => servedTasks({ "company-news-search": { content: "Actualité de {{entreprise}}", search } });

    expect((await taskRun(served({ provider: "brave", model: null }), "company-news-search", ai, (message) => warnings.push(message))).searchRoute).toBeUndefined();
    expect((await taskRun(served({ provider: "tavily", model: "ultra" }), "company-news-search", ai, (message) => warnings.push(message))).searchRoute).toBeUndefined();
    // A caller whose AI layer offers no web search (a test double) gets the configured route too.
    expect((await taskRun(served({ provider: "tavily", model: null }), "company-news-search", { agentModels: () => [] }, (message) => warnings.push(message))).searchRoute).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/web-search provider \(brave default model\) is not offered/), expect.stringMatching(/tavily ultra/), expect.stringMatching(/tavily default model/)]);
  });

  it("is nothing for a task that runs only from a served version, the Job Offer Summary, when none is", async () => {
    const { ai } = layer();

    expect(await servedTaskRun(servedTasks({}), "job-offer-reading", ai)).toBeNull();
    expect(await servedTaskRun(undefined, "job-offer-reading", ai)).toBeNull();
    expect((await servedTaskRun(servedTasks({ "job-offer-reading": { content: "- résumé" } }), "job-offer-reading", ai))?.text()).toBe("- résumé");
  });
});

describe("a Task Playbook's fallback is recorded on the AI call it runs, Outcome warning (#260)", () => {
  /** The AI Usage entry of one call made the way the AI tasks make it: `...run.agent` spread in. */
  async function recordedCall(run: Awaited<ReturnType<typeof taskRun>>, section?: string) {
    const { ai, usage } = layer();
    await ai.generate({ task: "writing", candidateId: "cand-1", system: run.text(section), prompt: "Lettre", ...run.agent });
    return usage.entries[0]!;
  }

  it("no version served: task_playbook_fallback, the built-in text used", async () => {
    const entry = await recordedCall(await taskRun(servedTasks({}), "cover-letter", layer().ai, quiet));

    expect(entry).toMatchObject({ outcome: "warning", reason: "task_playbook_fallback", warnings: [{ reason: "task_playbook_fallback", detail: expect.stringContaining('"cover-letter"') }] });
  });

  it("its served version could not be read: task_playbook_unreadable", async () => {
    const entry = await recordedCall(await taskRun(async () => Promise.reject(new Error("database down")), "cover-letter", layer().ai, quiet));

    expect(entry).toMatchObject({ outcome: "warning", reason: "task_playbook_unreadable", warnings: [{ reason: "task_playbook_unreadable", detail: expect.stringContaining("database down") }] });
  });

  it("its served version lacks the section the call needs: task_playbook_section_missing", async () => {
    const entry = await recordedCall(await taskRun(servedTasks({ "tailored-cv": { content: "## fr\n\nAdapte." } }), "tailored-cv", layer().ai, quiet), "en");

    expect(entry).toMatchObject({ outcome: "warning", reason: "task_playbook_section_missing", warnings: [{ reason: "task_playbook_section_missing", detail: expect.stringMatching(/"tailored-cv" v2 has no section "en"/) }] });
  });

  it("its Playbook Agent is no longer offered: task_playbook_agent_not_offered, the configured route used", async () => {
    const entry = await recordedCall(await taskRun(servedTasks({ "tailored-cv": { content: "Adapte.", agent: taskAgent("openai", "gpt-5") } }), "tailored-cv", layer().ai, quiet));

    expect(entry).toMatchObject({ provider: "mistral", outcome: "warning", reason: "task_playbook_agent_not_offered", warnings: [{ reason: "task_playbook_agent_not_offered", detail: expect.stringContaining("openai gpt-5") }] });
  });

  it("its web-search provider is no longer offered: task_playbook_search_not_offered on its search", async () => {
    const { ai, usage } = layer();
    const run = await taskRun(servedTasks({ "company-facts-search": { content: "Qui est {{entreprise}} ?", search: { provider: "brave", model: null } } }), "company-facts-search", ai, quiet);

    await ai.searchCompany({ candidateId: "cand-1", employer: "Acme", instructions: run.text(), route: run.searchRoute, warnings: run.warnings });

    expect(usage.entries[0]).toMatchObject({ task: "web_search", outcome: "warning", reason: "task_playbook_search_not_offered", warnings: [{ reason: "task_playbook_search_not_offered", detail: expect.stringContaining("brave") }] });
  });

  it("a served version run as it is leaves the call ok", async () => {
    const entry = await recordedCall(await taskRun(servedTasks({ "tailored-cv": { content: "Adapte.", agent: taskAgent("anthropic", "claude-opus-5-5") } }), "tailored-cv", layer().ai, quiet));

    expect(entry).toMatchObject({ outcome: "ok" });
    expect(entry).not.toHaveProperty("warnings");
  });

  it("without a reader (a caller not wired to the database), the built-in text is used silently", async () => {
    expect(await recordedCall(await taskRun(undefined, "cover-letter", layer().ai, quiet))).toMatchObject({ outcome: "ok" });
  });
});

describe("each AI task reads its served task Playbook", () => {
  const SERVED = { agent: taskAgent("anthropic", "claude-opus-5-5", "low") };

  it("CV reading: the served instructions then the JSON shape, on its Playbook Agent, identity still declared", async () => {
    const { ai, mistral, claude } = layer();

    await readCvWithAi("Marie Dupont", () => ai, "cand-1", { taskPlaybooks: servedTasks({ "cv-reading": { content: "Recopie le CV.", ...SERVED } }) });

    expect(mistral.calls).toHaveLength(0);
    expect(claude.calls[0]).toMatchObject({ model: "claude-opus-5-5", effort: "low" });
    expect(claude.calls[0]!.system).toMatch(/^Recopie le CV\.\nRéponds uniquement avec le JSON, au format :\n\{"masterCv"/);
  });

  it("CV reading: version 1, the built-in text, word for word as before", async () => {
    const { ai, mistral } = layer();

    await readCvWithAi("Marie Dupont", () => ai, "cand-1");

    expect(mistral.calls[0]!.system).toBe(`Tu lis le CV d'un candidat et tu le recopies, section par section, dans un objet JSON.
Règles :
- Recopie uniquement ce qui est écrit dans le CV, dans sa langue. N'invente, ne reformule et n'ajoute rien.
- Laisse une chaîne vide ("") ou une liste vide ([]) quand le CV ne dit rien.
- "period" et "level" sont recopiés tels qu'écrits (ex. "2015 – 2024", "courant").
- searchCriteria.targetRole : le poste que le candidat semble viser (titre du CV ou poste le plus récent).
- searchCriteria.location : la ville où il habite, si le CV l'indique.
Réponds uniquement avec le JSON, au format :
{"masterCv":{"fullName":"","headline":"","email":"","phone":"","location":"","summary":"",
"experience":[{"title":"","employer":"","location":"","period":"","description":""}],
"education":[{"degree":"","institution":"","year":""}],
"skills":[""],"languages":[{"name":"","level":""}]},
"searchCriteria":{"targetRole":"","location":""}}`);
  });

  it("Follow-up: the section for its language and rank, then no one named and the JSON shape, on its Playbook Agent", async () => {
    const { ai, claude } = layer(JSON.stringify({ subject: "Relance", text: "Bonjour" }));
    const taskPlaybooks = servedTasks({ "follow-up": { content: "## fr 1\n\nPremière.\n\n## fr 2\n\nDeuxième.\n\n## en 1\n\nFirst.\n\n## en 2\n\nSecond.", ...SERVED } });
    const jobOffer = { title: "DAF", employer: "Acme", content: "…" };

    await followUpDraft({ ai, candidateId: "cand-1", language: "fr", jobOffer, followUpNumber: 2, taskPlaybooks });
    await followUpDraft({ ai, candidateId: "cand-1", language: "en", jobOffer, followUpNumber: 1, taskPlaybooks });

    expect(claude.calls.map((call) => call.system)).toEqual([
      `Deuxième.\n- Ne nomme aucune personne de l'entreprise.\nRéponds uniquement avec un objet JSON : {"subject": "objet de l'e-mail", "text": "texte de l'e-mail"}.`,
      `First.\n- Do not name anyone at the company.\nReply with a JSON object only: {"subject": "the email subject", "text": "the email text"}.`,
    ]);
    expect(claude.calls[0]).toMatchObject({ effort: "low" });
  });
});
