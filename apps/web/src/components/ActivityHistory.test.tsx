// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { rulesProvenance, type Provenance, type ReplyCost } from "@jobhub/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activityEntries, type ReplyGiven } from "@/ai-activity/entries";
import { renderInFrench } from "@/design/testing";
import { ActivityHistory } from "./ActivityHistory";

vi.mock("next/navigation", () => ({ usePathname: () => "/profils/p/cv-de-reference" }));

const NOW = new Date();
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const CV = "/profils/p/versions/7";
const SENT: ReplyCost = { calls: 4, turns: 2, rounds: 1, inputTokens: 21_000, cachedInputTokens: 9_000, outputTokens: 400 };

const written: Provenance = {
  v: 1,
  steps: [{ kind: "ai", activity: "think_write", task: "coaching", provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-large-latest", tokens: { input: 6_000, output: 900 }, ms: 9_000, at: minutesAgo(10), outcome: "ok", count: 1 }],
  sites: [{ kind: "web", domain: "welcometothejungle.com", links: ["https://www.welcometothejungle.com/offre"] }],
  startedAt: minutesAgo(10),
  wallMs: 9_000,
};

const reply: ReplyGiven = {
  messageId: minutesAgo(10),
  at: minutesAgo(10),
  question: "Peux-tu renforcer mon CV ?",
  provenance: written,
  sent: SENT,
  cards: [{ id: "card-7", status: "accepted", decidedAt: minutesAgo(8), change: { target: { href: "/profils/p/cv-de-reference", name: "CV de référence" }, what: "2 modifications", before: "Version 6", after: "Version 7" } }],
};

const entries = activityEntries({
  page: "profile",
  replies: [reply],
  versions: [{ version: 7, savedAt: minutesAgo(8), restoredFrom: null, origin: { cardId: "card-7" }, href: CV }],
  elements: [{ kind: "ats_score", provenance: rulesProvenance("ats_score", { at: new Date(minutesAgo(7)) }), scored: 7, href: "/profils/p/ats-score", result: { score: 79 } }],
});

function show(given = entries, inThread: ReadonlySet<string> = new Set([reply.messageId])) {
  renderInFrench(<ActivityHistory entries={given} inThread={inThread} usage={[{ quota: "atsScores", used: 4, limit: 7 }]} asked={null} />);
  return screen.getByRole("region", { name: "Historique" });
}

describe("the history of Activity (#808)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });

  it("lists today's entries, newest first, one row each: a button with its title, result and cost in short", () => {
    const history = show();
    const today = within(history).getByRole("region", { name: "Aujourd'hui" });
    const rows = within(today).getAllByRole("button");
    expect(rows.map((row) => row.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    expect(rows[0]!.textContent).toMatch(/^ATS Score79\/100 · 1 ATS Score du forfait · 4 sur 7 cette semaine\d\d:\d\d$/);
    expect(rows[1]!.textContent).toMatch(/^Version 7 du CV de référenceSans IA/);
    expect(rows[2]!.textContent).toMatch(/^Réponse du coach1 proposition · 4 appels · 21,4k jetons envoyés/);
    expect(history.textContent).not.toMatch(/€|euro/i);
  });

  it("unfolds an entry's detail, with « suite de » leading to the entry that caused it", async () => {
    const user = userEvent.setup();
    const history = show();
    const [score, version] = within(history).getAllByRole("button");
    await user.click(score!);
    expect(score!.getAttribute("aria-expanded")).toBe("true");
    const detail = document.getElementById(score!.getAttribute("aria-controls")!)!;
    expect(detail.textContent).toContain("↳ suite de Version 7 du CV de référence");
    expect(within(detail).getByRole("link", { name: "Voir l'ATS Score" }).getAttribute("href")).toBe("/profils/p/ats-score");
    expect(within(detail).getByRole("link", { name: /1 ATS Score du forfait/ }).getAttribute("href")).toBe("/abonnement#consommation");

    await user.click(within(detail).getByRole("button", { name: /Version 7 du CV de référence/ }));
    expect(version!.getAttribute("aria-expanded")).toBe("true");
    const versionDetail = document.getElementById(version!.getAttribute("aria-controls")!)!;
    expect(within(versionDetail).getByRole("link", { name: "Ouvrir la version" }).getAttribute("href")).toBe(CV);
    expect(versionDetail.textContent).toContain("↳ suite de Réponse du coach");
  });

  it("shows a reply's question, models, proposals and what they led to, its cost, and « Voir dans la conversation » when the thread shows it", async () => {
    const user = userEvent.setup();
    const history = show();
    const row = within(history).getAllByRole("button")[2]!;
    await user.click(row);
    const detail = document.getElementById(row.getAttribute("aria-controls")!)!;
    expect(detail.textContent).toContain("Vous : Peux-tu renforcer mon CV ?");
    expect(detail.textContent).toContain("Modèles : Mistral Large");
    expect(detail.textContent).toContain("2 modifications : Version 6 → Version 7");
    expect(detail.textContent).toContain("Appliquée");
    expect(detail.textContent).toContain("→ a donné Version 7 du CV de référence");
    expect(within(detail).getByRole("link", { name: "compté dans votre consommation" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "Voir dans la conversation" })).toBeTruthy();
  });

  it("says « dernier appel seulement » for a reply saved before #791, and no « Voir dans la conversation » for one the thread does not show", async () => {
    const user = userEvent.setup();
    const before = activityEntries({ page: "any", replies: [{ ...reply, sent: null, cards: [] }] });
    const history = show(before, new Set());
    const row = within(history).getByRole("button");
    expect(row.textContent).toContain("6,9k jetons · dernier appel seulement");
    await user.click(row);
    expect(within(history).queryByRole("button", { name: "Voir dans la conversation" })).toBeNull();
  });

  it("folds « Sources et outils de cette page » at its foot, each site once", async () => {
    const user = userEvent.setup();
    show();
    const sources = screen.getByRole("button", { name: "Sources et outils de cette page" });
    expect(sources.getAttribute("aria-expanded")).toBe("false");
    await user.click(sources);
    expect(screen.getAllByRole("button", { name: /welcometothejungle\.com/ })).toHaveLength(1);
    expect(screen.getByText("Règles Jobbbox")).toBeTruthy();
  });

  it("unfolds the entry « Dans l'activité » asks for, each time it is asked", () => {
    const { rerender } = renderInFrench(<ActivityHistory entries={entries} inThread={new Set()} usage={null} asked={null} />);
    const row = () => screen.getAllByRole("button")[1]!;
    expect(row().getAttribute("aria-expanded")).toBe("false");
    rerender(<ActivityHistory entries={entries} inThread={new Set()} usage={null} asked={{ key: entries[1]!.key, n: 1 }} />);
    expect(row().getAttribute("aria-expanded")).toBe("true");
  });

  it("says when nothing happened on the page yet", () => {
    expect(show([]).textContent).toContain("Rien encore sur cette page.");
  });
});
