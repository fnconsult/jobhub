import { ACTIVITIES, PROVENANCE_RULES, TOOLS, type Activity } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { activityOf, FEATURE_STEPS, TOOL_STEPS } from "./activity";
import { SEARCH_TASK, TEXT_TASKS, type AiTask } from "./types";

const AI_TASKS: AiTask[] = [...(Object.keys(TEXT_TASKS) as AiTask[]), SEARCH_TASK];

describe("the Activity of a step", () => {
  it("is set for every AI task", () => {
    for (const task of AI_TASKS) expect(ACTIVITIES, task).toContain(activityOf({ kind: "ai", task }));
  });

  it("is set, or said never to be one of its own, for every Tool of the catalog", () => {
    for (const tool of TOOLS) expect([...ACTIVITIES, "by_task", "not_a_step"], tool.id).toContain(TOOL_STEPS[tool.id]);
  });

  it("is an Activity for every Tool that finds, reads or checks what a result is built from", () => {
    for (const tool of TOOLS.filter(({ category }) => ["job_discovery", "company_data", "contact_enrichment"].includes(category))) {
      expect(ACTIVITIES, tool.id).toContain(TOOL_STEPS[tool.id]);
    }
  });

  it("is named by its AI task for a call to an AI model or a web search", () => {
    for (const tool of TOOLS.filter(({ category }) => category === "ai_model" || category === "web_search")) expect(TOOL_STEPS[tool.id], tool.id).toBe("by_task");
  });

  it("is set for every rule", () => {
    for (const rule of PROVENANCE_RULES) expect(activityOf({ kind: "rules", rule }), rule).toBe("compute");
  });

  it.each<[string, Parameters<typeof activityOf>[0], Activity]>([
    ["job title variants", { kind: "ai", task: "job_titles" }, "think"],
    ["a web search", { kind: "ai", task: "web_search" }, "web_search"],
    ["reading a CV", { kind: "ai", task: "cv_parsing" }, "read"],
    ["writing a Tailored Document", { kind: "ai", task: "writing" }, "write"],
    ["a Job Offer's summary", { kind: "ai", task: "offer_analysis" }, "think_write"],
    ["an AI Coach reply", { kind: "ai", task: "coaching" }, "think_write"],
    ["France Travail", { kind: "tool", tool: "france-travail" }, "search"],
    ["Fantastic.jobs", { kind: "tool", tool: "fantastic-jobs" }, "search"],
    ["an ATS", { kind: "tool", tool: "greenhouse" }, "search"],
    ["the company register", { kind: "tool", tool: "recherche-entreprises" }, "search"],
    ["reading a job site's page", { kind: "tool", tool: "job-site" }, "read"],
    ["reading an APEC page", { kind: "tool", tool: "apec" }, "read"],
    ["a Match Score", { kind: "rules", rule: "match_score" }, "compute"],
    ["an ATS Score", { kind: "rules", rule: "ats_score" }, "compute"],
    ["ATS Fixes", { kind: "rules", rule: "ats_fixes" }, "compute"],
  ])("is fixed in code by default: %s", (_, step, activity) => {
    expect(activityOf(step)).toBe(activity);
  });

  it.each<[keyof typeof FEATURE_STEPS, Activity]>([
    ["read_job_page", "read"],
    ["company_dossier_agency_check", "think"],
    ["coach_choice", "think"],
    ["playbook_agent", "think"],
    ["tailored_cv_translation", "think"],
  ])("is fixed in code per feature step, over its task's: %s", (featureStep, activity) => {
    expect(FEATURE_STEPS[featureStep]).toBe(activity);
  });
});
