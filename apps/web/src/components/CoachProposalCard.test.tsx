// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useEffect, useState } from "react";
import { act, screen, within } from "@testing-library/react";
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
function Thread({ card = PENDING, pane = true, openOnArrival = false }: { card?: Card; pane?: boolean; openOnArrival?: boolean }) {
  const [shown, setShown] = useState(card);
  const content = <CoachProposalCard card={shown} onChange={setShown} openOnArrival={openOnArrival} />;
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

describe("a reply to an Exchange proposed (#1099, ADR-0115)", () => {
  const REPLY: Card = {
    ...PENDING,
    change: {
      target: { kind: "application", id: "a1", name: "Data scientist · Benchling", href: "/candidatures/a1/echanges" },
      what: "Réponse à « Entretien »",
      before: "Entretien",
      after: "Bonjour Jane,\n\nMardi à 14 h me convient.\n\nMarie",
      handOver: { to: "jane@benchling.com", subject: "Re: Entretien" },
      value: { exchangeId: "x1", text: "Bonjour Jane,\n\nMardi à 14 h me convient.\n\nMarie" },
      fields: [],
    },
  };
  const replyCard = () => screen.getByRole("article", { name: /Réponse à « Entretien »/ });

  it("shows to whom and the whole text, with « Copier » and « Ouvrir dans ma messagerie » in place of « Appliquer »: Jobbbox sends nothing", () => {
    renderInFrench(<Thread card={REPLY} />);

    expect(replyCard().querySelector(".coach-proposal-card__text")?.textContent).toBe("Bonjour Jane,\n\nMardi à 14 h me convient.\n\nMarie");
    expect(replyCard().textContent).toContain("À : jane@benchling.com · Objet : Re: Entretien");
    expect(replyCard().textContent).toContain("Jobbbox n'envoie rien");
    expect(within(replyCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Copier", "Ignorer"]);
    expect(within(replyCard()).getByRole("link", { name: "Ouvrir dans ma messagerie" }).getAttribute("href")).toBe(
      "mailto:jane%40benchling.com?subject=Re%3A%20Entretien&body=Bonjour%20Jane%2C%0A%0AMardi%20%C3%A0%2014%20h%20me%20convient.%0A%0AMarie",
    );
  });

  it("« Copier » puts the text on the clipboard and says the reply was taken", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    answers = [{ status: 200, body: { card: { ...REPLY, status: "accepted", decidedAt: "2026-11-04T17:20:00.000Z" } } }];
    renderInFrench(<Thread card={REPLY} />);

    await userEvent.click(within(replyCard()).getByRole("button", { name: "Copier" }));

    expect(writeText).toHaveBeenCalledWith("Bonjour Jane,\n\nMardi à 14 h me convient.\n\nMarie");
    expect(sent).toEqual([{ url: `/api/action-cards/${REPLY.id}`, body: { decision: "accept" } }]);
    await vi.waitFor(() => expect(within(replyCard()).getByRole("status").textContent).toMatch(/^Prise par vous à \d\d:\d\d : envoyez-la depuis votre messagerie\. Réponse copiée/));
    // Still there to copy again, or to open in the mailbox.
    expect(within(replyCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Copier"]);
  });
});

describe("a Send proposed: « Envoyer à Prénom N. », sent on the Candidate's click (ADR-0119, #1162)", () => {
  const SEND: Card = {
    ...PENDING,
    change: {
      target: { kind: "application", id: "a1", name: "Consultante achats · Exemple Conseil", href: "/candidatures/a1/propositions" },
      what: "Envoyer à Claire M.",
      before: "Relance de ma candidature",
      after: "Bonjour Claire,\n\nJe reviens vers vous.\n\nNathalie",
      value: { subject: "Relance de ma candidature", text: "Bonjour Claire,\n\nJe reviens vers vous.\n\nNathalie", document: "follow_up" },
      fields: [
        { name: "subject", label: "Objet", type: "text" },
        { name: "text", label: "Texte", type: "textarea" },
      ],
      send: { to: { email: "claire.martin@exemple-conseil.test", name: "Claire Martin" }, as: "Nathalie Exemple via Jobbbox", copyTo: "nathalie.exemple@example.fr", room: { sentToday: 2, cap: 20 } },
    },
  };
  const sendCard = () => screen.getByRole("article", { name: /Envoyer à Claire M\./ });

  it("shows the whole text, the recipient, who it goes out as, the copy and today's Sends, with « Envoyer », « Modifier avant d'envoyer » and « Ignorer »", () => {
    renderInFrench(<Thread card={SEND} />);

    expect(sendCard().querySelector(".coach-proposal-card__text")?.textContent).toBe("Bonjour Claire,\n\nJe reviens vers vous.\n\nNathalie");
    const text = sendCard().textContent ?? "";
    expect(text).toContain("À : Claire Martin <claire.martin@exemple-conseil.test>");
    expect(text).toContain("De : Nathalie Exemple via Jobbbox, depuis une adresse jobbbox.ai");
    expect(text).toContain("Copie et réponses : nathalie.exemple@example.fr");
    expect(text).toContain("Objet : Relance de ma candidature");
    expect(text).toContain("Envois aujourd'hui : 2 sur 20.");
    expect(text).toContain("Une fois envoyé, l'e-mail ne peut pas être annulé.");
    expect(within(sendCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Envoyer", "Modifier avant d'envoyer", "Ignorer"]);
  });

  it("« Envoyer » sends one decision, its buttons off while it is sent; then says it was sent, with no « Annuler »", async () => {
    let answer: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Promise<Response>((resolve) => (answer = resolve));
    });
    renderInFrench(<Thread card={SEND} />);

    const envoyer = within(sendCard()).getByRole("button", { name: "Envoyer" });
    await userEvent.click(envoyer);
    await userEvent.click(envoyer);

    expect(sent).toEqual([{ url: `/api/action-cards/${SEND.id}`, body: { decision: "accept" } }]);
    expect((envoyer as HTMLButtonElement).disabled).toBe(true);
    await act(async () => answer(new Response(JSON.stringify({ card: { ...SEND, status: "accepted", decidedAt: "2026-11-27T09:20:00.000Z", undoable: false } }), { status: 200 })));
    await vi.waitFor(() => expect(within(sendCard()).getByRole("status").textContent).toMatch(/^Envoyé par vous à \d\d:\d\d : vous êtes en copie/));
    expect(within(sendCard()).queryAllByRole("button")).toEqual([]);
  });

  it("says the cap reached on the card, with no « Envoyer »", () => {
    renderInFrench(<Thread card={{ ...SEND, change: { ...SEND.change, send: { ...SEND.change.send!, room: { sentToday: 20, cap: 20 }, capReached: true } } }} />);

    expect(sendCard().textContent).toContain("Plafond atteint : vous avez envoyé 20 messages depuis Jobbbox aujourd'hui.");
    expect(within(sendCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Ignorer"]);
  });

  it("says an email whose fate is unknown will not be sent again, with no « Envoyer »", () => {
    renderInFrench(<Thread card={{ ...SEND, change: { ...SEND.change, send: { ...SEND.change.send!, uncertain: true } } }} />);

    expect(sendCard().textContent).toContain("Nous ne savons pas si l'e-mail est parti");
    expect(within(sendCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Ignorer"]);
  });

  it("says the email did not go when the server could not send it, the card still there to try again", async () => {
    answers = [{ status: 502, body: { error: "failed" } }];
    renderInFrench(<Thread card={SEND} />);

    await userEvent.click(within(sendCard()).getByRole("button", { name: "Envoyer" }));

    await vi.waitFor(() => expect(within(sendCard()).getByRole("alert").textContent).toBe("L'e-mail n'est pas parti. Réessayez dans un instant."));
    expect(within(sendCard()).getByRole("button", { name: "Envoyer" })).toBeTruthy();
  });
});

describe("a draft's new text proposed (ADR-0109)", () => {
  const TEXT: Card = {
    ...PENDING,
    change: {
      target: { kind: "application", id: "a1", name: "Head Of BU · Fynd Recrutement", href: "/candidatures/a1/propositions" },
      what: "Relance",
      before: "Bonjour,\n\nUne relance longue.\n\nCordialement,",
      after: "Bonjour,\n\nOù en est le recrutement ?\n\nCordialement,",
      value: { subject: "Relance", text: "Bonjour,\n\nOù en est le recrutement ?\n\nCordialement," },
      fields: [
        { name: "subject", label: "Objet", type: "text" },
        { name: "text", label: "Texte", type: "textarea" },
      ],
    },
  };
  const textCard = () => screen.getByRole("article", { name: /Relance/ });

  it("shows the new text in full, its lines kept, and the current one folded under « Texte actuel »", () => {
    renderInFrench(<Thread card={TEXT} />);

    const after = textCard().querySelector(".coach-proposal-card__text");
    expect(after?.textContent).toBe("Bonjour,\n\nOù en est le recrutement ?\n\nCordialement,");
    const current = within(textCard()).getByText("Texte actuel");
    expect(current.closest("details")?.open).toBe(false);
    expect(current.closest("details")?.textContent).toContain("Une relance longue.");
    expect(textCard().textContent).not.toContain("→");
    expect(within(textCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Appliquer", "Modifier avant d'appliquer", "Ignorer"]);
  });

  it("applied after an edit, shows the text the Candidate applied, never its subject glued to it", () => {
    renderInFrench(<Thread card={applied({ change: TEXT.change, edited: { subject: "Relance", text: "Mon texte à moi." } })} />);

    expect(textCard().querySelector(".coach-proposal-card__text")?.textContent).toBe("Mon texte à moi.");
  });
});

describe("an Interview's note proposed (ADR-0114)", () => {
  const INTERVIEW = "lundi 2 novembre 2026 à 10:00 · 60 min · Sur place · Siège, Toulouse";
  const NOTE = "Questions posées :\n- la clôture en J+5\n- la consolidation IFRS";
  const NOTE_CARD: Card = {
    ...PENDING,
    change: {
      target: { kind: "application", id: "a1", name: "Contrôleuse de gestion · Airbus", href: "/candidatures/a1/entretiens" },
      what: "Entretien",
      before: INTERVIEW,
      after: INTERVIEW,
      text: { name: "note", what: "Note de l'entretien", before: "Avec la DAF", after: NOTE },
      value: { interviewId: "i1", scheduledAt: "2026-11-02T10:00", durationMinutes: "60", format: "on_site", place: "Siège, Toulouse", note: NOTE },
      fields: [
        { name: "scheduledAt", label: "Date et heure de l'entretien (heure de Paris)", type: "datetime" },
        { name: "note", label: "Note (facultatif)", type: "textarea" },
      ],
    },
  };
  const noteCard = () => screen.getByRole("article", { name: /Entretien/ });

  it("names the Interview, shows the new note in full, its lines kept, and the current one folded under « Texte actuel »", () => {
    renderInFrench(<Thread card={NOTE_CARD} />);

    expect(noteCard().textContent).toContain(INTERVIEW);
    expect(noteCard().textContent).not.toContain("→");
    expect(noteCard().textContent).toContain("Note de l'entretien");
    expect(noteCard().querySelector(".coach-proposal-card__text")?.textContent).toBe(NOTE);
    const current = within(noteCard()).getByText("Texte actuel");
    expect(current.closest("details")?.open).toBe(false);
    expect(current.closest("details")?.textContent).toContain("Avec la DAF");
    expect(within(noteCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Appliquer", "Modifier avant d'appliquer", "Ignorer"]);
  });

  it("beside a date change: the change before → after, then the note; nothing folded when the Interview had no note", () => {
    const moved: Card = { ...NOTE_CARD, change: { ...NOTE_CARD.change, after: "mardi 3 novembre 2026 à 10:00 · 60 min · Sur place · Siège, Toulouse", text: { ...NOTE_CARD.change.text!, before: "" } } };
    renderInFrench(<Thread card={moved} />);

    expect(noteCard().textContent).toContain(`Avant : ${INTERVIEW} → , après : mardi 3 novembre 2026`);
    expect(noteCard().querySelector(".coach-proposal-card__text")?.textContent).toBe(NOTE);
    expect(within(noteCard()).queryByText("Texte actuel")).toBeNull();
  });

  it("applied after an edit, shows the note the Candidate applied, not the note glued to the Interview", () => {
    renderInFrench(<Thread card={applied({ change: NOTE_CARD.change, edited: { ...NOTE_CARD.change.value, note: "Ma note à moi." } })} />);

    expect(noteCard().querySelector(".coach-proposal-card__text")?.textContent).toBe("Ma note à moi.");
    expect(noteCard().textContent).toContain(INTERVIEW);
    expect(noteCard().textContent).not.toContain("Ma note à moi., ");
  });
});

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

  it("« Annuler » that left the Application Status as it was says so on the card (#770)", async () => {
    answers = [{ status: 200, body: { status: "undone", card: applied({ status: "undone", undoneAt: "2026-11-04T17:25:00.000Z", undoable: false, undoNote: "status_kept" }) } }];
    renderInFrench(<Thread card={applied()} />);

    await userEvent.click(button("Annuler"));

    expect(within(card()).getByRole("status").textContent).toMatch(/^Annulé à \d\d:\d\d Le statut de la candidature avait changé depuis : il est laissé tel quel\.$/);
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

  it("arriving under « Formulaire » (#717), opens its form in the Work Pane by itself, its buttons still on the card", () => {
    renderInFrench(<Thread openOnArrival />);

    const pane = screen.getByRole("complementary");
    expect(within(pane).getByRole("heading", { level: 2 }).textContent).toContain("Modifier avant d'appliquer : Statut de la candidature");
    expect((within(pane).getByRole("combobox", { name: "Statut de la candidature" }) as HTMLSelectElement).value).toBe("interview");
    expect(within(card()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Appliquer", "Modifier avant d'appliquer", "Ignorer"]);
    expect(sent).toEqual([]);
  });

  it("arriving under « Formulaire » (#775), leaves the focus where the Candidate is; « Modifier avant d'appliquer » takes it to the form", async () => {
    const reply = { arrive: () => {} };
    function Conversation() {
      const [arrived, setArrived] = useState(false);
      useEffect(() => {
        reply.arrive = () => setArrived(true);
      }, []);
      return (
        <WorkPaneProvider version="1.2.3">
          <main id="main">
            <textarea aria-label="Votre message" />
            {arrived ? <CoachProposalCard card={PENDING} onChange={() => {}} openOnArrival /> : null}
          </main>
          <WorkPane />
        </WorkPaneProvider>
      );
    }
    renderInFrench(<Conversation />);
    // The Candidate types their next message as the reply and its card arrive.
    const box = screen.getByRole("textbox", { name: "Votre message" });
    box.focus();
    act(() => reply.arrive());

    const pane = screen.getByRole("complementary");
    expect(within(pane).getByRole("combobox", { name: "Statut de la candidature" })).toBeTruthy();
    expect(document.activeElement).toBe(box);

    await userEvent.click(button("Modifier avant d'appliquer"));
    expect(document.activeElement).toBe(within(screen.getByRole("complementary")).getByRole("heading", { level: 2 }));
  });

  it("under « Carte » (the default), only the card shows: the Work Pane stays closed", () => {
    renderInFrench(<Thread />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("arriving under « Formulaire » without a Work Pane, opens its form in the card", () => {
    renderInFrench(<Thread pane={false} openOnArrival />);
    expect(within(card()).getByRole("combobox", { name: "Statut de la candidature" })).toBeTruthy();
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

  it("« Appliquer » with no room left since the proposal shows the Upgrade prompt, not a conflict; the card still waits (#773)", async () => {
    const prompt = { title: "Profils actifs au maximum", message: "Passez à Premium.", upgradeTo: "premium" as const, action: "Voir les offres", href: "/compte/abonnement" };
    answers = [{ status: 409, body: { error: "quota", card: { ...PENDING, change: { ...PENDING.change, quota: { label: "1 profil actif", prompt } } } } }];
    renderInFrench(<Thread />);

    await userEvent.click(button("Appliquer"));

    expect(within(card()).getByRole("alert").textContent).toContain("Profils actifs au maximum");
    expect(within(card()).queryByText(/L'objet a changé/)).toBeNull();
    expect(within(card()).queryByRole("button", { name: "Appliquer" })).toBeNull();
  });

  describe("a Job Search proposed (#720): launched, never undone", () => {
    const SEARCH: Card = {
      id: "55555555-5555-4555-8555-555555555555",
      status: "pending",
      change: {
        target: { kind: "profile", id: "p1", name: "DAF", href: "/recherches?profil=p1" },
        what: "Recherche d'offres",
        before: "Aucune recherche lancée",
        after: "Sur les critères du profil : DAF · Lyon · CDI",
        value: { profileId: "p1" },
        fields: [],
        quota: { label: "1 recherche sur 5 cette semaine : il vous en restera 4" },
        launches: true,
      },
      undoable: false,
    };
    const searchCard = () => screen.getByRole("article", { name: /Recherche d'offres/ });

    it("offers « Lancer » and « Ignorer », the Plan Quota it uses said; nothing to edit", () => {
      renderInFrench(<Thread card={SEARCH} />);

      expect(searchCard().textContent).toContain("1 recherche sur 5 cette semaine : il vous en restera 4");
      expect(within(searchCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Lancer", "Ignorer"]);
    });

    it("« Lancer » launches it and says so, sending to AI Activity to follow or stop it: no « Annuler »", async () => {
      answers = [{ status: 200, body: { status: "accepted", card: { ...SEARCH, status: "accepted", decidedAt: "2026-11-04T17:20:00.000Z", undoable: false } } }];
      renderInFrench(<Thread card={SEARCH} />);

      await userEvent.click(within(searchCard()).getByRole("button", { name: "Lancer" }));

      expect(sent).toEqual([{ url: `/api/action-cards/${SEARCH.id}`, body: { decision: "accept" } }]);
      expect(within(searchCard()).getByRole("status").textContent).toMatch(/^Lancé par vous à \d\d:\d\d$/);
      expect(searchCard().textContent).toContain("Suivez-la dans Activité IA ; « Arrêter la recherche d'offres » l'interrompt.");
      expect(within(searchCard()).queryAllByRole("button")).toEqual([]);
    });
  });

  describe("an Interview proposed from the Agenda (#718)", () => {
    const INTERVIEW: Card = {
      id: "44444444-4444-4444-8444-444444444444",
      status: "pending",
      change: {
        target: { kind: "application", id: "a1", name: "Contrôleuse de gestion · Airbus", href: "/candidatures/a1/entretiens" },
        what: "Nouvel entretien",
        before: "Aucun",
        after: "jeudi 12 novembre 2026 à 14:00 · 45 min · Visio",
        also: [{ what: "Statut de la candidature", before: "Postulée", after: "Entretien" }],
        value: { scheduledAt: "2026-11-12T14:00", durationMinutes: "45", format: "video", place: "" },
        fields: [
          { name: "scheduledAt", label: "Date et heure de l'entretien (heure de Paris)", type: "datetime" },
          { name: "durationMinutes", label: "Durée en minutes (facultatif)", type: "number" },
          { name: "format", label: "Format (facultatif)", type: "select", options: [{ value: "", label: "Non précisé" }, { value: "video", label: "Visio" }] },
          { name: "place", label: "Lieu ou lien (facultatif)", type: "text" },
        ],
      },
      undoable: false,
    };
    const interviewCard = () => screen.getByRole("article", { name: /Nouvel entretien/ });

    it("lists both changes on one card: the Interview at its absolute date, and the Application moved to « Entretien »", () => {
      renderInFrench(<Thread card={INTERVIEW} />);

      const changes = within(interviewCard()).getAllByRole("listitem").map((each) => each.textContent);
      expect(changes).toEqual(["Nouvel entretien : Avant : Aucun → , après : jeudi 12 novembre 2026 à 14:00 · 45 min · Visio", "Statut de la candidature : Avant : Postulée → , après : Entretien"]);
    });

    it("« Modifier avant d'appliquer » shows the Interview form's date and time and duration as such, pre-filled", async () => {
      renderInFrench(<Thread card={INTERVIEW} pane={false} />);

      await userEvent.click(within(interviewCard()).getByRole("button", { name: "Modifier avant d'appliquer" }));

      const date = within(interviewCard()).getByLabelText("Date et heure de l'entretien (heure de Paris)") as HTMLInputElement;
      expect([date.type, date.value]).toEqual(["datetime-local", "2026-11-12T14:00"]);
      const duration = within(interviewCard()).getByLabelText("Durée en minutes (facultatif)") as HTMLInputElement;
      expect([duration.type, duration.value]).toEqual(["number", "45"]);
    });
  });
});

/** A Master CV change (#719): two changes, the second a Flagged Change. */
const MASTER_CV: Card = {
  id: "44444444-4444-4444-8444-444444444444",
  status: "pending",
  change: {
    target: { kind: "profile", id: "p1", name: "Directrice financière", href: "/profils/p1/cv-de-reference" },
    what: "CV de référence",
    before: "Version 3",
    after: "2 changements à relire",
    value: {},
    fields: [],
    review: {
      changes: [
        { id: "experience.rephrased.0", section: "experience", kind: "rephrased", item: "Directrice financière · Groupe Seb", master: "Pilotage financier.", tailored: "Pilotage financier d'un groupe industriel." },
        { id: "summary.rephrased", section: "summary", kind: "rephrased", master: "25 ans dans l'industrie.", tailored: "25 ans dans l'aéronautique.", fromOffer: ["aéronautique"] },
      ],
      edits: [],
    },
  },
  undoable: false,
};

describe("a Master CV change's card, reviewed change by change (#719, ADR-0006)", () => {
  const masterCard = () => screen.getByRole("article", { name: /CV de référence/ });

  it("names the object it changes in its title: « CV de référence · Profil Directrice financière » (ADR-0114)", () => {
    renderInFrench(<Thread card={MASTER_CV} />);

    expect(within(masterCard()).getByRole("heading", { level: 4 }).textContent).toBe("CV de référence · Profil Directrice financière");
    expect(within(masterCard()).getByRole("link", { name: "Profil Directrice financière" }).getAttribute("href")).toBe("/profils/p1/cv-de-reference");
  });

  it("has no « Appliquer » in one click: « Relire les changements » opens them in the Work Pane, none accepted in advance", async () => {
    renderInFrench(<Thread card={MASTER_CV} />);
    expect(within(masterCard()).getAllByRole("button").map((each) => each.textContent)).toEqual(["Relire les changements", "Ignorer"]);

    await userEvent.click(within(masterCard()).getByRole("button", { name: "Relire les changements" }));
    const pane = screen.getByRole("complementary");
    expect(within(pane).getByRole("heading", { level: 2 }).textContent).toContain("Relire les changements : CV de référence");
    expect(within(pane).getAllByRole("listitem")).toHaveLength(2);
    expect(within(pane).getByRole("note").textContent).toContain("aéronautique");
    // Each change waits for the Candidate's own « Accepter » (ADR-0077): none is pre-accepted, flagged or not.
    expect(within(pane).getAllByRole("button", { name: "Accepter" }).map((each) => each.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
    expect(pane.textContent).toContain("aucun n'est accepté d'avance");
  });

  it("saves nothing when « Enregistrer » is pressed before any change is accepted", async () => {
    renderInFrench(<Thread card={MASTER_CV} />);
    await userEvent.click(within(masterCard()).getByRole("button", { name: "Relire les changements" }));
    const pane = screen.getByRole("complementary");
    await userEvent.click(within(pane).getByRole("button", { name: "Enregistrer les changements acceptés" }));

    expect(sent).toEqual([]);
    expect(within(pane).getByRole("alert").textContent).toContain("Acceptez au moins un changement");
  });

  it("sends only the changes the Candidate accepted, explicitly", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: { ...MASTER_CV, status: "accepted", decidedAt: "2026-11-05T10:20:00.000Z", undoable: true, accepted: ["experience.rephrased.0"] } } }];
    renderInFrench(<Thread card={MASTER_CV} />);
    await userEvent.click(within(masterCard()).getByRole("button", { name: "Relire les changements" }));
    const pane = screen.getByRole("complementary");
    await userEvent.click(within(pane).getAllByRole("button", { name: "Accepter" })[0]!);
    await userEvent.click(within(pane).getByRole("button", { name: "Enregistrer les changements acceptés" }));

    expect(sent).toEqual([{ url: `/api/action-cards/${MASTER_CV.id}`, body: { decision: "accept", edited: { accepted: ["experience.rephrased.0"] } } }]);
    expect(masterCard().textContent).toContain("1 changement enregistré");
    expect(within(masterCard()).getByRole("button", { name: "Annuler" })).toBeTruthy();
  });

  it("saves nothing while no change is accepted", async () => {
    renderInFrench(<Thread card={MASTER_CV} />);
    await userEvent.click(within(masterCard()).getByRole("button", { name: "Relire les changements" }));
    const pane = screen.getByRole("complementary");
    await userEvent.click(within(pane).getAllByRole("button", { name: "Refuser" })[0]!);
    await userEvent.click(within(pane).getByRole("button", { name: "Enregistrer les changements acceptés" }));

    expect(sent).toEqual([]);
    expect(within(pane).getByRole("alert").textContent).toContain("Acceptez au moins un changement");
  });
});

/** A Tailored CV change (ADR-0113): a Layout-only Change on the saved Tailored CV, then one adding a Declared Fact. */
const TAILORED_CV: Card = {
  id: "66666666-6666-4666-8666-666666666666",
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "Lead Finance · Benchling", href: "/candidatures/a1/documents?resultat=cv-adapte" },
    what: "CV adapté",
    before: "Version 3 enregistrée",
    after: "1 changement à relire",
    value: { base: "saved" },
    fields: [],
    layoutOnly: true,
    review: { changes: [{ id: "skills.rephrased.2", section: "skills", kind: "rephrased", item: "SQL, utilisé pour le reporting", master: "SQL, utilisé pour le reporting", tailored: "SQL" }], edits: [] },
  },
  undoable: false,
};

describe("a Tailored CV change's card, reviewed change by change in the Work Pane (ADR-0113, #1097)", () => {
  const tailoredCard = () => screen.getByRole("article", { name: /CV adapté/ });

  it("says a Layout-only Change adds no word, and opens its review in the Work Pane, about the Tailored CV", async () => {
    renderInFrench(<Thread card={TAILORED_CV} />);
    expect(within(tailoredCard()).getByRole("heading", { level: 4 }).textContent).toBe("CV adapté · Lead Finance · Benchling");
    expect(tailoredCard().textContent).toContain("Mise en forme seule, aucun mot ajouté");

    await userEvent.click(within(tailoredCard()).getByRole("button", { name: "Relire les changements" }));
    const pane = screen.getByRole("complementary");
    expect(pane.textContent).toContain("pour le CV adapté de « Lead Finance · Benchling »");
    expect(within(pane).getAllByRole("button", { name: "Accepter" }).map((each) => each.getAttribute("aria-pressed"))).toEqual(["false"]);
  });

  it("marks a Declared Fact « Fait déclaré par vous » and a change with the offer's words « Reprend les mots de l'offre », none pre-accepted", async () => {
    const declared: Card = {
      ...TAILORED_CV,
      change: {
        ...TAILORED_CV.change,
        layoutOnly: undefined as never,
        review: {
          changes: [
            { id: "skills.added.Power BI", section: "skills", kind: "added", item: "Power BI", declared: true },
            { id: "summary.rephrased", section: "summary", kind: "rephrased", master: "Pilotage financier.", tailored: "Pilotage FP&A sous Anaplan.", fromOffer: ["Anaplan"] },
          ],
          edits: [],
        },
      },
    };
    delete (declared.change as { layoutOnly?: true }).layoutOnly;
    renderInFrench(<Thread card={declared} />);
    expect(tailoredCard().textContent).not.toContain("Mise en forme seule");

    await userEvent.click(within(tailoredCard()).getByRole("button", { name: "Relire les changements" }));
    const pane = screen.getByRole("complementary");
    expect(pane.textContent).toContain("Fait déclaré par vous");
    expect(pane.textContent).toContain("Reprend les mots de l'offre : Anaplan");
    expect(within(pane).getAllByRole("button", { name: "Accepter" }).map((each) => each.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
  });
});

describe("a card about the Coach Memory (#719)", () => {
  it("names it without a link: it has no page", () => {
    const memory: Card = {
      ...PENDING,
      id: "55555555-5555-4555-8555-555555555555",
      change: {
        target: { kind: "coach_memory", id: "m1", name: "Mémoire du coach", href: "" },
        what: "À retenir",
        before: "Pas encore retenu",
        after: "Objectif : Un poste de DAF à Lyon",
        value: { kind: "goal", text: "Un poste de DAF à Lyon" },
        fields: [],
      },
    };
    renderInFrench(<Thread card={memory} />);
    const shown = screen.getByRole("article", { name: /À retenir/ });
    expect(within(shown).getByRole("heading", { level: 4 }).textContent).toBe("À retenir · Mémoire du coach");
    expect(within(shown).queryByRole("link")).toBeNull();
  });
});

describe("the Action Card on the Design System (#788)", () => {
  const stylesheet = () => readFileSync("apps/web/src/components/CoachProposalCard.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleOf = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.$]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(stylesheet())?.[1] ?? "";

  it("is a Card, its title in the card's head, its buttons small Design System Buttons: primary, secondary, quiet", () => {
    renderInFrench(<Thread />);

    expect(card().classList.contains("ds-card")).toBe(true);
    expect(card().querySelector(".ds-card__head")!.contains(within(card()).getByRole("heading", { level: 4 }))).toBe(true);
    expect(within(card()).getAllByRole("button").map((each) => each.className)).toEqual([
      "ds-button ds-button--primary ds-button--sm",
      "ds-button ds-button--secondary ds-button--sm",
      "ds-button ds-button--quiet ds-button--sm",
    ]);
  });

  it("takes only the width it needs, 34rem at most; no accent edge of its own: the Card's border, radius and shadow", () => {
    const rule = ruleOf(".coach-proposal-card");
    expect(rule).toMatch(/width:\s*fit-content/);
    expect(rule).toMatch(/max-width:\s*min\(100%,\s*34rem\)/);
    expect(stylesheet()).not.toMatch(/border-left/);
    expect(rule).not.toMatch(/(?:^|;|\s)(background|border|border-radius|box-shadow)\s*:/);
  });
});
