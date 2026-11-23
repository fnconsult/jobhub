// @vitest-environment jsdom
import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachProposalCard as Card } from "@/coach-proposals/card";
import { renderInFrench } from "@/design/testing";
import { CoachProposalCard } from "./CoachProposalCard";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

/**
 * A « Documents » proposal's card (#721, ADR-0077): « Préparer » or « Rédiger » launches the AI action the documents page
 * runs, in the Candidate's own request, its steps live on the card beside « Arrêter »; done, its Result opens in the Work
 * Pane (a Tailored CV's Review). A draft that exists is said to be replaced, edits included, and confirmed first.
 */
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/candidatures/a1", useRouter: () => ({ push, refresh }) }));

const OPENS_CV = "/candidatures/a1/documents?resultat=cv-adapte";
const TAILORED_CV: Card = {
  id: "66666666-6666-4666-8666-666666666666",
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "DAF H/F · Acme Industrie", href: OPENS_CV },
    what: "CV adapté",
    before: "Aucun CV adapté",
    after: "Une proposition à relire changement par changement · Français",
    value: {},
    fields: [],
    launches: true,
    runs: { kind: "tailored_cv", url: "/api/applications/a1/tailored-cv", body: { language: "fr" }, opens: OPENS_CV },
  },
  undoable: false,
};

const OPENS_LETTER = "/candidatures/a1/documents?resultat=lettre";
const LETTER: Card = {
  id: "77777777-7777-4777-8777-777777777777",
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "DAF H/F · Acme Industrie", href: OPENS_LETTER },
    what: "Lettre de motivation",
    before: "Brouillon du 2 novembre 2026, modifié depuis",
    after: "Un brouillon rédigé par votre coach IA · Français",
    value: {},
    fields: [],
    launches: true,
    runs: { kind: "tailored_documents", url: "/api/applications/a1/tailored-documents", body: { document: "cover_letter", language: "fr" }, opens: OPENS_LETTER },
    replaces: "Votre brouillon actuel sera remplacé : il restera dans « Versions », modifications comprises.",
  },
  undoable: false,
};

const accepted = (card: Card): Card => ({ ...card, status: "accepted", decidedAt: "2026-11-05T10:20:00.000Z", undoable: false });

/** What the server answers each request: JSON, an AI action's live steps (NDJSON), or nothing until it is aborted. */
type Answer = { status: number; body: unknown } | { ndjson: object[] } | { hang: true };
let answers: Answer[];
let sent: { url: string; body: unknown }[];

function Thread({ card }: { card: Card }) {
  const [shown, setShown] = useState(card);
  return (
    <WorkPaneProvider version="1.2.3">
      <main id="main">
        <CoachProposalCard card={shown} onChange={setShown} />
      </main>
      <WorkPane />
    </WorkPaneProvider>
  );
}

const cardNamed = (what: RegExp) => screen.getByRole("article", { name: what });
const buttonsOf = (card: HTMLElement) => within(card).queryAllByRole("button").map((each) => each.textContent);

beforeEach(() => {
  answers = [];
  sent = [];
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const answer = answers.shift() ?? { status: 500, body: { error: "failed" } };
    if ("hang" in answer)
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    if ("ndjson" in answer)
      return new Response(answer.ndjson.map((event) => `${JSON.stringify(event)}\n`).join(""), { status: 200, headers: { "content-type": "application/x-ndjson" } });
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("a « Documents » proposal's card (#721)", () => {
  it("a Tailored CV: « Préparer » and « Ignorer », nothing to replace nor to edit", () => {
    renderInFrench(<Thread card={TAILORED_CV} />);

    const card = cardNamed(/CV adapté/);
    expect(within(card).getByRole("link", { name: "DAF H/F · Acme Industrie" }).getAttribute("href")).toBe(OPENS_CV);
    expect(buttonsOf(card)).toEqual(["Préparer", "Ignorer"]);
  });

  it("« Préparer » launches the Tailored CV proposal from the card, then opens its Tailored CV Review in the Work Pane", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: accepted(TAILORED_CV) } }, { ndjson: [{ type: "done", documentLanguage: "fr", proposal: null, saved: null }] }];
    renderInFrench(<Thread card={TAILORED_CV} />);

    await userEvent.click(within(cardNamed(/CV adapté/)).getByRole("button", { name: "Préparer" }));

    // The card is applied first, then the AI action runs through its own route, as the documents page runs it.
    expect(sent).toEqual([
      { url: `/api/action-cards/${TAILORED_CV.id}`, body: { decision: "accept" } },
      { url: "/api/applications/a1/tailored-cv", body: { language: "fr" } },
    ]);
    expect(within(cardNamed(/CV adapté/)).getByRole("status").textContent).toMatch(/^Lancé par vous à \d\d:\d\d$/);
    expect(push).toHaveBeenCalledWith(OPENS_CV, { scroll: false });
    // No « Annuler »: Stop ends it.
    expect(buttonsOf(cardNamed(/CV adapté/))).toEqual([]);
  });

  it("offers « Arrêter » while it runs: stopped, it says so and nothing opens", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: accepted(TAILORED_CV) } }, { hang: true }];
    renderInFrench(<Thread card={TAILORED_CV} />);

    await userEvent.click(within(cardNamed(/CV adapté/)).getByRole("button", { name: "Préparer" }));
    await userEvent.click(await within(cardNamed(/CV adapté/)).findByRole("button", { name: "Arrêter" }));

    expect((await within(cardNamed(/CV adapté/)).findAllByRole("status")).map((each) => each.textContent).join(" ")).toMatch(/Arrêtée à \d\d:\d\d/);
    expect(push).not.toHaveBeenCalled();
  });

  it("refused as changed since, nothing runs", async () => {
    answers = [{ status: 409, body: { error: "conflict" } }];
    renderInFrench(<Thread card={TAILORED_CV} />);

    await userEvent.click(within(cardNamed(/CV adapté/)).getByRole("button", { name: "Préparer" }));

    expect(sent).toHaveLength(1);
    expect(within(cardNamed(/CV adapté/)).getByRole("alert").textContent).toContain("L'objet a changé depuis la proposition");
  });

  it("the run failing: the card says so and where to try again", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: accepted(TAILORED_CV) } }, { status: 503, body: { error: "unavailable" } }];
    renderInFrench(<Thread card={TAILORED_CV} />);

    await userEvent.click(within(cardNamed(/CV adapté/)).getByRole("button", { name: "Préparer" }));

    expect((await within(cardNamed(/CV adapté/)).findByRole("alert")).textContent).toContain("Le document n'a pas pu être préparé");
    expect(push).not.toHaveBeenCalled();
  });

  describe("a draft that exists: its replacement confirmed first", () => {
    it("the card says the draft will be replaced, edits included; « Rédiger » asks to confirm, sending nothing", async () => {
      renderInFrench(<Thread card={LETTER} />);
      const card = cardNamed(/Lettre de motivation/);

      expect(card.textContent).toContain("Votre brouillon actuel sera remplacé : il restera dans « Versions », modifications comprises.");
      expect(buttonsOf(card)).toEqual(["Rédiger", "Ignorer"]);

      await userEvent.click(within(card).getByRole("button", { name: "Rédiger" }));

      expect(sent).toEqual([]);
      expect(within(card).getByRole("group", { name: "Remplacer votre brouillon actuel ? Il restera dans « Versions »." })).toBeTruthy();
      expect(buttonsOf(card)).toEqual(["Remplacer et rédiger", "Garder mon brouillon"]);
      expect(document.activeElement?.textContent).toBe("Remplacer et rédiger");
    });

    it("« Garder mon brouillon » keeps it: nothing sent, « Rédiger » offered again", async () => {
      renderInFrench(<Thread card={LETTER} />);
      const card = cardNamed(/Lettre de motivation/);

      await userEvent.click(within(card).getByRole("button", { name: "Rédiger" }));
      await userEvent.click(within(card).getByRole("button", { name: "Garder mon brouillon" }));

      expect(sent).toEqual([]);
      expect(buttonsOf(card)).toEqual(["Rédiger", "Ignorer"]);
    });

    it("« Remplacer et rédiger » applies it and runs the drafting, then opens the draft in the Work Pane", async () => {
      answers = [{ status: 200, body: { status: "accepted", card: accepted(LETTER) } }, { ndjson: [{ type: "done", documentLanguage: "fr", coverLetter: null, outreachMessage: null }] }];
      renderInFrench(<Thread card={LETTER} />);
      const card = cardNamed(/Lettre de motivation/);

      await userEvent.click(within(card).getByRole("button", { name: "Rédiger" }));
      await userEvent.click(within(card).getByRole("button", { name: "Remplacer et rédiger" }));

      expect(sent).toEqual([
        { url: `/api/action-cards/${LETTER.id}`, body: { decision: "accept" } },
        { url: "/api/applications/a1/tailored-documents", body: { document: "cover_letter", language: "fr" } },
      ]);
      expect(push).toHaveBeenCalledWith(OPENS_LETTER, { scroll: false });
    });

    it("a draft to write with none before: « Rédiger » runs at once", async () => {
      const fresh: Card = { ...LETTER, change: { ...LETTER.change, before: "Aucun brouillon" } };
      delete (fresh.change as Partial<Card["change"]>).replaces;
      answers = [{ status: 200, body: { status: "accepted", card: accepted(fresh) } }, { ndjson: [{ type: "done" }] }];
      renderInFrench(<Thread card={fresh} />);

      await userEvent.click(within(cardNamed(/Lettre de motivation/)).getByRole("button", { name: "Rédiger" }));

      expect(sent.map((each) => each.url)).toEqual([`/api/action-cards/${LETTER.id}`, "/api/applications/a1/tailored-documents"]);
    });
  });

  describe("a Tailored CV proposal still under review (#774): its replacement confirmed first", () => {
    const PENDING_REVIEW: Card = { ...TAILORED_CV, change: { ...TAILORED_CV.change, replaces: "Votre proposition de CV adapté en cours de relecture sera remplacée, vos réponses comprises." } };

    it("the card says so; « Préparer » asks to confirm in the proposal's words, sending nothing; « Garder ma proposition » keeps it", async () => {
      renderInFrench(<Thread card={PENDING_REVIEW} />);
      const card = cardNamed(/CV adapté/);

      expect(card.textContent).toContain("Votre proposition de CV adapté en cours de relecture sera remplacée, vos réponses comprises.");
      await userEvent.click(within(card).getByRole("button", { name: "Préparer" }));

      expect(sent).toEqual([]);
      expect(within(card).getByRole("group", { name: "Remplacer votre proposition de CV adapté en cours de relecture, vos réponses comprises ?" })).toBeTruthy();
      expect(buttonsOf(card)).toEqual(["Remplacer et préparer", "Garder ma proposition"]);
      expect(document.activeElement?.textContent).toBe("Remplacer et préparer");

      await userEvent.click(within(card).getByRole("button", { name: "Garder ma proposition" }));
      expect(sent).toEqual([]);
      expect(buttonsOf(card)).toEqual(["Préparer", "Ignorer"]);
    });

    it("« Remplacer et préparer » applies it and runs the Tailored CV proposal", async () => {
      answers = [{ status: 200, body: { status: "accepted", card: accepted(PENDING_REVIEW) } }, { ndjson: [{ type: "done" }] }];
      renderInFrench(<Thread card={PENDING_REVIEW} />);
      const card = cardNamed(/CV adapté/);

      await userEvent.click(within(card).getByRole("button", { name: "Préparer" }));
      await userEvent.click(within(card).getByRole("button", { name: "Remplacer et préparer" }));

      await waitFor(() => expect(sent.map((each) => each.url)).toEqual([`/api/action-cards/${PENDING_REVIEW.id}`, "/api/applications/a1/tailored-cv"]));
    });
  });

  it("launched before, the card says where the document is, and opens it beside the conversation", () => {
    renderInFrench(<Thread card={accepted(LETTER)} />);
    const card = cardNamed(/Lettre de motivation/);

    expect(card.textContent).toContain("Votre lettre de motivation est dans Documents › Lettre de motivation.");
    expect(within(card).getByRole("link", { name: "Ouvrir à côté de la conversation" }).getAttribute("href")).toBe(OPENS_LETTER);
    expect(card.textContent).toContain("Si vous l'avez arrêtée, rien n'a été gardé.");
    expect(buttonsOf(card)).toEqual([]);
  });

  it("launched before, a Tailored CV's says where its proposal waits for the review", () => {
    renderInFrench(<Thread card={accepted(TAILORED_CV)} />);
    const card = cardNamed(/CV adapté/);

    expect(card.textContent).toContain("La proposition de CV adapté est dans Documents › CV adapté, à relire changement par changement.");
    expect(within(card).getByRole("link", { name: "Ouvrir à côté de la conversation" }).getAttribute("href")).toBe(OPENS_CV);
  });
});

describe("a Company Dossier's « Mettre à jour » card (ADR-0114)", () => {
  const OPENS_DOSSIER = "/candidatures/a1/dossier";
  const DOSSIER: Card = {
    id: "88888888-8888-4888-8888-888888888888",
    status: "pending",
    change: {
      target: { kind: "application", id: "a1", name: "DAF H/F · Acme Industrie", href: OPENS_DOSSIER },
      what: "Dossier entreprise",
      before: "Dossier du 30 octobre 2026",
      after: "Mis à jour quand vous lancerez « Mettre à jour » : registre des entreprises ou pages web, et actualités",
      value: {},
      fields: [],
      quota: { label: "Ne compte dans aucun quota de votre offre" },
      launches: true,
      runs: { kind: "company_dossier", url: "/api/applications/a1/company-dossier", body: {}, opens: OPENS_DOSSIER },
    },
    undoable: false,
  };

  it("says its Plan Quota and offers « Mettre à jour » and « Ignorer »", () => {
    renderInFrench(<Thread card={DOSSIER} />);
    const card = cardNamed(/Dossier entreprise/);

    expect(card.textContent).toContain("Ne compte dans aucun quota de votre offre");
    expect(buttonsOf(card)).toEqual(["Mettre à jour", "Ignorer"]);
  });

  it("« Mettre à jour » applies the card, then rebuilds the dossier through its Section's route, and opens it", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: accepted(DOSSIER) } }, { ndjson: [{ type: "done", status: "built" }] }];
    renderInFrench(<Thread card={DOSSIER} />);

    await userEvent.click(within(cardNamed(/Dossier entreprise/)).getByRole("button", { name: "Mettre à jour" }));

    expect(sent).toEqual([
      { url: `/api/action-cards/${DOSSIER.id}`, body: { decision: "accept" } },
      { url: "/api/applications/a1/company-dossier", body: {} },
    ]);
    await waitFor(() => expect(push).toHaveBeenCalledWith(OPENS_DOSSIER, { scroll: false }));
  });

  it("the rebuild failing: the card says so and where to try again", async () => {
    answers = [{ status: 200, body: { status: "accepted", card: accepted(DOSSIER) } }, { status: 503, body: { error: "unavailable" } }];
    renderInFrench(<Thread card={DOSSIER} />);

    await userEvent.click(within(cardNamed(/Dossier entreprise/)).getByRole("button", { name: "Mettre à jour" }));

    expect((await within(cardNamed(/Dossier entreprise/)).findByRole("alert")).textContent).toContain("Le dossier entreprise n'a pas pu être mis à jour");
  });

  it("launched before, the card says where the dossier is, and that a stop keeps what was found", () => {
    renderInFrench(<Thread card={accepted(DOSSIER)} />);
    const card = cardNamed(/Dossier entreprise/);

    expect(card.textContent).toContain("Le dossier entreprise est dans la section Dossier de la candidature.");
    expect(within(card).getByRole("link", { name: "Ouvrir à côté de la conversation" }).getAttribute("href")).toBe(OPENS_DOSSIER);
    expect(card.textContent).toContain("Si vous l'avez arrêtée, ce qui était déjà trouvé est gardé.");
  });
});
