import { describe, expect, it } from "vitest";
import { BLOCK_COUNT, blockNumber, blockOf, blockProgress, INTERVIEW_BLOCKS } from "./blocks";
import type { InterviewField } from "./fields";

describe("the four blocks of the interview without a CV, once the Profile is born (#1046)", () => {
  it("are criteria, career, skills and presentation, in that order", () => {
    expect(INTERVIEW_BLOCKS).toEqual(["criteria", "career", "skills", "presentation"]);
    expect(BLOCK_COUNT).toBe(4);
    expect(INTERVIEW_BLOCKS.map(blockNumber)).toEqual([1, 2, 3, 4]);
  });

  it("put every field but the target role and a place in one block", () => {
    expect(blockOf("targetRole")).toBeNull();
    expect(blockOf("locations")).toBeNull();
    expect(blockOf("contractTypes")).toBe("criteria");
    expect(blockOf("minSalary")).toBe("criteria");
    expect(blockOf("domains")).toBe("criteria");
    expect(blockOf("experience.title")).toBe("career");
    expect(blockOf("education.year")).toBe("career");
    expect(blockOf("skills")).toBe("skills");
    expect(blockOf("languages")).toBe("skills");
    expect(blockOf("summary")).toBe("presentation");
    expect(blockOf("headline")).toBe("presentation");
    expect(blockOf("fullName")).toBe("presentation");
  });

  it("marks a question only where a block starts: once per block, not at each question", () => {
    const fields: InterviewField[] = ["targetRole", "locations", "contractTypes", "remoteWorkOptions", "experience.title", "experience.employer", "skills", "summary"];
    expect(blockProgress(fields).marks).toEqual([null, null, "criteria", null, "career", null, "skills", "presentation"]);
    expect(blockProgress(fields).current).toBe("presentation");
  });

  it("never goes back to an earlier block, a question on it counted in the block reached", () => {
    const fields: InterviewField[] = ["contractTypes", "skills", "minSalary", "languages", "targetRole"];
    expect(blockProgress(fields).marks).toEqual(["criteria", "skills", null, null, null]);
    expect(blockProgress(fields).current).toBe("skills");
  });

  it("is at the first block until a question of one is asked", () => {
    expect(blockProgress([]).current).toBe("criteria");
    expect(blockProgress(["targetRole", "locations"]).current).toBe("criteria");
  });

  it("resumes at the block reached (« Reprendre la création »): its first question marked, none before it", () => {
    expect(blockProgress([], "career").current).toBe("career");
    expect(blockProgress(["contractTypes", "experience.title", "experience.period"], "career").marks).toEqual(["career", null, null]);
    expect(blockProgress(["skills"], "career")).toEqual({ marks: ["skills"], current: "skills" });
  });
});
