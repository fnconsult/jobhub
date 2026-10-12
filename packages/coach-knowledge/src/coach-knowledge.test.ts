import { describe, expect, it } from "vitest";
import { loadCoachKnowledge } from "./index";

describe("loadCoachKnowledge — the imported playbooks", () => {
  const knowledge = loadCoachKnowledge({ environment: "eval" });

  it("exposes a playbook by id with its frontmatter, rules and sources", () => {
    const playbook = knowledge.playbook("coaching-journey-gamification");

    expect(playbook).toMatchObject({
      id: "coaching-journey-gamification",
      title: "Parcours d'accompagnement : cadence, suivi et gamification",
      version: "1.0",
      updated: "2026-07-26",
      status: "validé (auto-QA Claude, 2026-07-26)",
    });
    expect(playbook?.sources.map((source) => source.id)).toEqual(["S24", "S35", "S54", "S55", "S56"]);
    expect(playbook?.rules).toHaveLength(12);
    expect(playbook?.rules[1]).toMatchObject({
      id: "R2",
      title: "Annoncez un effet réel mais modeste, jamais une promesse de résultat.",
      sourceIds: ["S55"],
    });
    expect(playbook?.rules[1]?.text).toMatch(/^Dans cette même évaluation, l'effet sur l'emploi durable/);
  });
});
