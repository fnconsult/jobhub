import { describe, expect, it } from "vitest";
import { knowledgeEnvironment } from "./knowledge-env";

describe("which coaching knowledge the app serves (ADR-0019)", () => {
  it("serves only Human-validated knowledge in production", () => {
    expect(knowledgeEnvironment({ NODE_ENV: "production" })).toBe("production");
  });

  it("serves everything in development and tests, so the AI Coach can be built before validation", () => {
    expect(knowledgeEnvironment({ NODE_ENV: "development" })).toBe("development");
    expect(knowledgeEnvironment({ NODE_ENV: "test" })).toBe("development");
    expect(knowledgeEnvironment({})).toBe("development");
  });

  it("follows COACH_KNOWLEDGE_ENVIRONMENT when set, e.g. to evaluate unvalidated playbooks on a production build", () => {
    expect(knowledgeEnvironment({ NODE_ENV: "production", COACH_KNOWLEDGE_ENVIRONMENT: "eval" })).toBe("eval");
    expect(knowledgeEnvironment({ NODE_ENV: "development", COACH_KNOWLEDGE_ENVIRONMENT: "production" })).toBe("production");
    expect(knowledgeEnvironment({ NODE_ENV: "production", COACH_KNOWLEDGE_ENVIRONMENT: "" })).toBe("production");
  });

  it("refuses an unknown COACH_KNOWLEDGE_ENVIRONMENT rather than guess", () => {
    expect(() => knowledgeEnvironment({ COACH_KNOWLEDGE_ENVIRONMENT: "staging" })).toThrow(/COACH_KNOWLEDGE_ENVIRONMENT/);
  });
});
