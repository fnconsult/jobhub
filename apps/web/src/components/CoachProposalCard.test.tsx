// @vitest-environment jsdom
import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachProposalCard as Card } from "@/coach-proposals/card";
import { renderInFrench } from "@/design/testing";
import { CoachProposalCard } from "./CoachProposalCard";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/candidatures/a1", useRouter: () => ({ push, refresh }) }));

const PENDING: Card = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "DAF H/F · Acme Industrie", href: "/candidatures/a1" },
    what: "Statut de la candidature",
    before: "Postulée",
    after: "Entretien",
    value: { status: "interview" },
    fields: [
      {
        name: "status",
        label: "Statut de la candidature",
        type: "select",
        options: [
          { value: "applied", label: "Postulée" },
          { value: "interview", label: "Entretien" },
          { value: "offer_received", label: "Offre reçue" },
        ],
      },
    ],
  },
  undoable: false,
};

/** The server's answer to each POST to /api/action-cards/…: its status and body. */
let answers: { status: number; body: unknown }[];
let sent: { url: string; body: unknown }[];

/** The card in a thread with a Work Pane, as « Conversation au centre » shows it; the card as the server last said it. */
function Thread({ card = PENDING, pane = true }: { card?: Card; pane?: boolean }) {
  const [shown, setShown] = useState(card);
  const content = <CoachProposalCard card={shown} onChange={setShown} />;
  if (!pane) return content;
  return (
    <WorkPaneProvider version="1.2.3">
      <main id="main">{content}</main>
      <WorkPane />
    </WorkPaneProvider>
  );
}

const card = () => screen.getByRole("article", { name: /Statut de la candidature/ });
const button = (name: string) => within(card()).getByRole("button", { name });

beforeEach(() => {
  answers = [];
  sent = [];
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const answer = answers.shift() ?? { status: 500, body: { error: "failed" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const applied = (more: Partial<Card> = {}): Card => ({ ...PENDING, status: "accepted", decidedAt: "2026-11-04T17:20:00.000Z", undoable: true, ...more });

describe("a Coach proposal's card in the thread (#715, ADR-0077)", () => {
  it("says what changes on which object, before → after, that the AI Coach proposed it, with its three buttons", () => {
    renderInFrench(<Thread />);

    expect(card().textContent).toContain("Proposé par votre coach IA");
    expect(within(card()).getByRole("heading", { level: 4 }).textContent).toContain("Statut de la candidature · DAF H/F · Acme Industrie");
    expect(within(card()).getByRole("link", { name: "DAF H/F · Acme Industrie" }).getAttribute("href")).toBe("/candidatures/a1");
    expect(card().textContent).toContain("Avant : Postulée → , après : Entretien");
    expect(within(card()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Appliquer", "Modifier avant d'appliquer", "Ignorer"]);
  });

  it("« Appliquer » applies it and says so politely, with « Annuler »; the page shows the object as it now is", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: applied() } }];
    renderInFrench(<Thread />);

    await userEvent.click(button("Appliquer"));

    expect(sent).toEqual([{ url: `/api/action-cards/${PENDING.id}`, body: { decision: "accept" } }]);
    expect(within(card()).getByRole("status").textContent).toMatch(/^Appliqué par vous à \d\d:\d\d$/);
    expect(within(card()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Annuler"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("« Annuler » puts the state before back; refused once the object changed since, it says so and offers it no more", async () => {
    answers = [
      { status: 409, body: { error: "conflict" } },
      { status: 200, body: { status: "undone", card: applied({ status: "undone", undoneAt: "2026-11-04T17:25:00.000Z", undoable: false }) } },
    ];
    renderInFrench(<Thread card={applied()} />);

    await userEvent.click(button("Annuler"));
    expect(within(card()).getByRole("alert").textContent).toContain("L'objet a changé depuis que vous avez appliqué la proposition : rien n'a été annulé.");
    expect(within(card()).queryByRole("button", { name: "Annuler" })).toBeNull();

    renderInFrench(<Thread card={applied({ id: "22222222-2222-4222-8222-222222222222" })} />);
    await userEvent.click(within(screen.getAllByRole("article")[1]!).getByRole("button", { name: "Annuler" }));
    expect(within(screen.getAllByRole("article")[1]!).getByRole("status").textContent).toMatch(/^Annulé à \d\d:\d\d$/);
  });

  it("refuses « Appliquer » when the object changed since the proposal: it says so, the card still waits", async () => {
    answers = [{ status: 409, body: { error: "conflict" } }];
    renderInFrench(<Thread />);

    await userEvent.click(button("Appliquer"));

    expect(within(card()).getByRole("alert").textContent).toContain("L'objet a changé depuis la proposition");
    expect(within(card()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Appliquer", "Modifier avant d'appliquer", "Ignorer"]);
  });

  it("« Ignorer » says « Ignoré », its buttons gone: never decided twice", async () => {
    answers = [{ status: 200, body: { status: "dismissed", card: { ...PENDING, status: "dismissed", decidedAt: "2026-11-04T17:20:00.000Z" } } }];
    renderInFrench(<Thread />);

    await userEvent.click(button("Ignorer"));

    expect(within(card()).getByRole("status").textContent).toContain("Ignoré");
    expect(within(card()).queryAllByRole("button")).toEqual([]);
    expect(sent).toEqual([{ url: `/api/action-cards/${PENDING.id}`, body: { decision: "dismiss" } }]);
  });

  it("« Modifier avant d'appliquer » opens the page's form pre-filled in the Work Pane, the focus on its title; what is changed there is kept when it closes", async () => {
    renderInFrench(<Thread />);

    await userEvent.click(button("Modifier avant d'appliquer"));
    const pane = screen.getByRole("complementary");
    expect(within(pane).getByRole("heading", { level: 2 }).textContent).toContain("Modifier avant d'appliquer : Statut de la candidature");
    expect(document.activeElement).toBe(within(pane).getByRole("heading", { level: 2 }));
    expect((within(pane).getByRole("combobox", { name: "Statut de la candidature" }) as HTMLSelectElement).value).toBe("interview");

    await userEvent.selectOptions(within(pane).getByRole("combobox", { name: "Statut de la candidature" }), "offer_received");
    await userEvent.click(within(pane).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("complementary")).toBeNull();

    await userEvent.click(button("Modifier avant d'appliquer"));
    expect((within(screen.getByRole("complementary")).getByRole("combobox", { name: "Statut de la candidature" }) as HTMLSelectElement).value).toBe("offer_received");
  });

  it("applies what was changed in the Work Pane, which then closes, the card saying it was applied", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: applied({ edited: { status: "offer_received" } }) } }];
    renderInFrench(<Thread />);

    await userEvent.click(button("Modifier avant d'appliquer"));
    const pane = screen.getByRole("complementary");
    await userEvent.selectOptions(within(pane).getByRole("combobox", { name: "Statut de la candidature" }), "offer_received");
    await userEvent.click(within(pane).getByRole("button", { name: "Appliquer" }));

    expect(sent).toEqual([{ url: `/api/action-cards/${PENDING.id}`, body: { decision: "accept", edited: { status: "offer_received" } } }]);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(card().textContent).toContain("Avant : Postulée → , après : Offre reçue");
    expect(within(card()).getByRole("status").textContent).toMatch(/^Appliqué par vous à/);
  });

  it("without a Work Pane, opens the form in the card", async () => {
    renderInFrench(<Thread pane={false} />);

    await userEvent.click(button("Modifier avant d'appliquer"));

    expect((within(card()).getByRole("combobox", { name: "Statut de la candidature" }) as HTMLSelectElement).value).toBe("interview");
  });

  it("says the Plan Quota it will use, and becomes the Upgrade prompt without room", () => {
    const withQuota = (prompt?: Card["change"]["quota"]) => ({ ...PENDING, change: { ...PENDING.change, ...(prompt ? { quota: prompt } : {}) } });
    renderInFrench(<Thread card={withQuota({ label: "1 recherche sur 5 cette semaine" })} />);
    expect(card().textContent).toContain("1 recherche sur 5 cette semaine");

    renderInFrench(
      <Thread
        card={{
          ...withQuota({ label: "1 recherche sur 5 cette semaine", prompt: { title: "Recherches épuisées", message: "Passez à Premium.", upgradeTo: "premium", action: "Voir les offres", href: "/compte/abonnement" } }),
          id: "33333333-3333-4333-8333-333333333333",
        }}
      />,
    );
    const full = screen.getAllByRole("article")[1]!;
    expect(within(full).getByRole("alert").textContent).toContain("Recherches épuisées");
    expect(within(full).queryByRole("button", { name: "Appliquer" })).toBeNull();
  });
});
