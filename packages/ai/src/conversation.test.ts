import { describe, expect, it } from "vitest";
import { hasBlocks, mapTexts, said, contentText } from "./conversation";
import type { TurnMessage } from "./types";

const ROUND: TurnMessage[] = [
  { role: "user", content: "Où en sont mes candidatures, Marie Dupont ?" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Je regarde." },
      { type: "tool_call", id: "call_1", name: "candidatures_lister", arguments: { statut: "envoyée", contact: { nom: "Marie Dupont" }, tags: ["a", 2] } },
    ],
  },
  { role: "user", content: [{ type: "tool_result", id: "call_1", content: "[DAF chez Globex]" }, { type: "tool_result", id: "call_2", content: "Unknown tool", error: true }] },
];

describe("a conversation with tool calls (#712)", () => {
  it("knows when it has blocks", () => {
    expect(hasBlocks([{ role: "user", content: "Bonjour" }])).toBe(false);
    expect(hasBlocks(ROUND)).toBe(true);
  });

  it("reads as text, each tool call and result named, for the AI Message Log and a provider without tool calling", () => {
    expect(said(ROUND)).toEqual([
      { role: "user", content: "Où en sont mes candidatures, Marie Dupont ?" },
      { role: "assistant", content: 'Je regarde.\n[appel d\'outil candidatures_lister #call_1] {"statut":"envoyée","contact":{"nom":"Marie Dupont"},"tags":["a",2]}' },
      { role: "user", content: "[résultat d'outil #call_1] [DAF chez Globex]\n[erreur d'outil #call_2] Unknown tool" },
    ]);
    expect(contentText(ROUND[2]!.content)).toBe("[résultat d'outil #call_1] [DAF chez Globex]\n[erreur d'outil #call_2] Unknown tool");
    expect(contentText("Bonjour")).toBe("Bonjour");
  });

  it("maps every text it holds at once, in order (message text, block text, each string of the arguments, results), keeping its shape", () => {
    const seen: string[] = [];
    const mapped = mapTexts(ROUND, (texts) => {
      seen.push(...texts);
      return texts.map((text) => text.toUpperCase());
    });

    expect(seen).toEqual(["Où en sont mes candidatures, Marie Dupont ?", "Je regarde.", "envoyée", "Marie Dupont", "a", "[DAF chez Globex]", "Unknown tool"]);
    expect(mapped[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "JE REGARDE." },
        { type: "tool_call", id: "call_1", name: "candidatures_lister", arguments: { statut: "ENVOYÉE", contact: { nom: "MARIE DUPONT" }, tags: ["A", 2] } },
      ],
    });
    expect(mapped[2]).toEqual({ role: "user", content: [{ type: "tool_result", id: "call_1", content: "[DAF CHEZ GLOBEX]" }, { type: "tool_result", id: "call_2", content: "UNKNOWN TOOL", error: true }] });
  });

  it("keeps text messages the very objects they were when nothing maps them differently", () => {
    const messages: TurnMessage[] = [{ role: "user", content: "Bonjour" }];
    expect(mapTexts(messages, (texts) => texts)[0]).toEqual(messages[0]);
  });
});
