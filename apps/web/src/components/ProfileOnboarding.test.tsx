// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityContent, AiActivityProvider } from "./AiActivity";
import { AiActivityLiveProvider } from "./AiActivityLive";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/profils/nouveau", useRouter: () => ({ push, refresh: vi.fn() }) }));

/** /profils/nouveau: the conversation in the page, the Work Pane beside it, and its Activity (#810). */
function NewProfilePage() {
  return (
    <AiActivityLiveProvider>
      <AiActivityProvider>
        <WorkPaneProvider version="1.2.3">
          <main>
            <ProfileOnboarding />
          </main>
          <WorkPane />
          <aside aria-label="Activité">
            <AiActivityContent />
          </aside>
        </WorkPaneProvider>
      </AiActivityProvider>
    </AiActivityLiveProvider>
  );
}

/**
 * The AI Coach's interview as `/api/onboarding/interview` streams it (#1002): each call the next of `turns`, a turn with
 * its Provenance, or "down" (the AI unavailable: the scripted questions take over). Past them, the AI is down too.
 */
function interviewReply(turns: (object | "down")[]): Response {
  const next = turns.shift() ?? "down";
  if (next === "down") return Response.json({ error: "failed", reason: "provider_unavailable" }, { status: 500 });
  const provenance = {
    v: 1,
    steps: [{ kind: "ai", activity: "think_write", task: "onboarding_interview", provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-medium-2508", ms: 800, at: new Date().toISOString(), outcome: "ok", count: 1, tokens: { input: 1200, output: 80 } }],
    sites: [{ kind: "candidate", links: [] }],
    startedAt: new Date().toISOString(),
    wallMs: 800,
  };
  return new Response(`${JSON.stringify({ type: "done", turn: next, provenance })}\n`, { headers: { "content-type": "application/x-ndjson" } });
}

/** A turn of the coach, as the route gives it once the code checked it. */
const ask = (field: string, question: string, extra: object = {}) => ({ ask: { field, question, kind: "text", optional: !["targetRole", "locations"].includes(field), ...extra }, done: false });
const ROLE = ask("targetRole", "Quel poste recherchez-vous ?");
const PLACE = ask("locations", "Dans quelle ville souhaitez-vous travailler ?");
const CONTRACT = {
  ...ask("contractTypes", "Quel type de contrat recherchez-vous ?", { kind: "choice", choices: ["cdi", "cdd", "freelance", "interim"] }),
  proposal: { field: "contractTypes", value: ["cdi"], because: "Un poste de direction est le plus souvent en CDI.", shown: "CDI" },
};
const DONE = { ...ask("summary", "Merci."), done: true };

const conversation = () => screen.getByRole("region", { name: "Créer un profil avec votre coach" });
const thread = () => screen.getByRole("list", { name: "Votre échange avec le coach" });
const reviewPane = () => screen.getByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" });

describe("creating a Profile is a conversation with the AI Coach (ADR-0070)", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    // The AI unavailable: the scripted questions (#1002's fallback), unless a test says otherwise.
    vi.stubGlobal("fetch", async (url: string) => (url === "/api/onboarding/interview" ? interviewReply([]) : new Response(null, { status: 404 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens on the Coach's Introduction, the CV's drop zone a card in the thread, the Questionnaire a suggestion above the box", () => {
    renderInFrench(<NewProfilePage />);
    expect(within(thread()).getByText(/Je vous aide à construire votre CV de référence/)).toBeTruthy();
    expect(within(thread()).getByRole("heading", { name: "J'ai un CV" })).toBeTruthy();
    expect(within(thread()).getByLabelText("Votre CV")).toBeTruthy();
    const suggestions = within(conversation()).getByRole("group", { name: "Suggestions" });
    expect(within(suggestions).getByRole("button", { name: "Répondre aux questions de mon coach" })).toBeTruthy();
  });

  it("asks the scripted questions in the thread when the AI cannot lead the interview, and takes the answers in the box at the foot", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));

    const box = await screen.findByLabelText("Votre réponse");
    expect(within(thread()).getByText(/Je continue avec mes questions habituelles, sans l'IA/)).toBeTruthy();
    expect(within(thread()).getByText("Pour commencer, quels sont vos prénom et nom ?")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.getAttribute("rows")).toBe("1");
    expect(box.closest(".coach-panel-composer-inline")).toBeTruthy();
    expect(within(thread()).getByText(/Très bien. Je vous pose mes questions une à une/)).toBeTruthy();
    expect(within(thread()).getByText("Répondre aux questions de mon coach")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "J'ai un CV" })).toBeNull();

    // A required question can't be left empty.
    await user.click(screen.getByRole("button", { name: "Envoyer au coach" }));
    expect(screen.getByRole("alert").textContent).not.toBe("");

    await user.type(box, "Marie Dupont{Enter}");
    expect(within(thread()).getByText("Marie Dupont")).toBeTruthy();
    expect(document.activeElement).toBe((await screen.findByLabelText("Votre réponse")));
  });

  it("has the coach's look of every conversation (#997): the welcome panel, the « Coach IA » badge, « Envoyer au coach »", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    const welcome = thread().querySelector(".welcome-panel")!;
    expect(welcome.textContent).toMatch(/Je suis un coach IA, pas une personne/);
    expect(welcome.textContent).toMatch(/Je vous aide à construire votre CV de référence/);
    const box = screen.getByLabelText("Votre message");
    expect(box.closest(".coach-panel-composer-inline")).toBeTruthy();
    expect(within(conversation()).getByRole("button", { name: "Envoyer au coach" })).toBeTruthy();

    await user.click(within(conversation()).getByRole("button", { name: "Le Coach IA : qui il est, ce qu'il voit" }));
    expect(await screen.findByRole("dialog", { name: "Votre coach IA" })).toBeTruthy();
  });

  it("starts the questions from what is typed in the box, and takes « oui » typed for a yes-or-no question", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.type(screen.getByLabelText("Votre message"), "Je n'ai pas de CV à jour{Enter}");
    expect(within(thread()).getByText("Je n'ai pas de CV à jour")).toBeTruthy();
    for (const said of ["Marie Dupont", "Directrice financière", "Lyon", "", "", "Directrice financière", "Acme", "Lyon", "2019 - 2024", "Pilotage"]) {
      if (said) await user.type((await screen.findByLabelText("Votre réponse")), `${said}{Enter}`);
      else await user.click(screen.getByRole("button", { name: "Passer cette question" }));
    }
    await user.type((await screen.findByRole("textbox", { name: "Votre réponse" })), "Non{Enter}");
    expect(within(thread()).getAllByText("Non").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("answers what is sent at the review by sending the Candidate back to it, without AI", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
    await user.type(screen.getByLabelText("Votre message"), "Et ensuite ?{Enter}");
    expect(within(thread()).getByText("Et ensuite ?")).toBeTruthy();
    expect(within(thread()).getByText(/Ici, je vous aide seulement à créer ce profil/)).toBeTruthy();
  });

  it("reviews an empty draft in the Work Pane when starting from scratch, and keeps what was changed when the pane closes", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));

    expect(within(thread()).getByText(/Remplissez votre CV de référence/)).toBeTruthy();
    await user.type(within(reviewPane()).getByLabelText("Nom et prénom"), "Marie Dupont");
    await user.click(within(reviewPane()).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "Relire et enregistrer" }));
    expect((within(reviewPane()).getByLabelText("Nom et prénom") as HTMLInputElement).value).toBe("Marie Dupont");
  });

  it("starts over from the review: the two paths again, the pane closed", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
    await user.click(within(reviewPane()).getByRole("button", { name: "Importer un autre CV" }));

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull());
    expect(within(thread()).getByRole("heading", { name: "J'ai un CV" })).toBeTruthy();
  });

  describe("the Profile born at its target role and location (ADR-0105, #999)", () => {
    type Call = { url: string; method: string; body: Record<string, unknown> };
    const interviewCalls: Record<string, unknown>[] = [];
    let calls: Call[];
    let created: number;
    let turns: (object | "down")[];

    beforeEach(() => {
      calls = [];
      created = 201;
      turns = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        // The Sectors' and Domains' labels: none here.
        if (url === "/api/reference-data") return new Response(null, { status: 404 });
        if (url === "/api/onboarding/interview") {
          interviewCalls.push(JSON.parse(String(init.body)));
          return interviewReply(turns);
        }
        calls.push({ url, method: init.method ?? "GET", body: JSON.parse(String(init.body ?? "{}")) });
        if (url === "/api/profiles") return Response.json(created === 201 ? { id: "p1" } : { error: "plan_quota_reached", prompt: null }, { status: created });
        if (url === "/api/profiles/p1/onboarding") return Response.json({ id: "p1", version: 2 });
        return Response.json({ id: "p1" });
      });
    });

    /** Answers the Questionnaire's first questions in the box, then skips each question left, to its review. */
    async function answerUpToReview(user: ReturnType<typeof userEvent.setup>, answers: string[]) {
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of answers) await user.type((await screen.findByLabelText("Votre réponse")), `${said}{Enter}`);
      while (!screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })) {
        await user.click(screen.getByRole("button", { name: "Passer cette question" }));
      }
    }

    it("creates the Profile once the target role and location are answered, its onboarding in progress, then nothing more until the review", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      await user.type((await screen.findByLabelText("Votre réponse")), "Marie Dupont{Enter}");
      await user.type((await screen.findByLabelText("Votre réponse")), "Directrice financière{Enter}");
      expect(calls).toEqual([]);

      await user.type((await screen.findByLabelText("Votre réponse")), "Lyon{Enter}");
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({
        url: "/api/profiles",
        method: "POST",
        body: {
          onboarding: "in_progress",
          searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] },
          masterCv: { fullName: "Marie Dupont", headline: "Directrice financière", location: "Lyon", email: "" },
        },
      });

      await user.type((await screen.findByLabelText("Votre réponse")), "marie.dupont@example.fr{Enter}");
      expect(calls).toHaveLength(1);

      // Its Activity says « Profil créé » as soon as it is born, still « En cours ».
      const activity = screen.getByRole("complementary", { name: "Activité" });
      const row = within(activity).getByRole("button", { name: /Création du profil/ });
      await user.click(row);
      expect(document.getElementById(row.getAttribute("aria-controls")!)!.textContent).toMatch(/Profil créé/);
    });

    it("saves the review on the Profile born: its Search Criteria, then one Master CV Version that finishes it", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon", "marie.dupont@example.fr"]);
      await user.click(within(reviewPane()).getByRole("button", { name: "Enregistrer mon profil" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/profils/p1"));
      expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual(["POST /api/profiles", "PATCH /api/profiles/p1", "POST /api/profiles/p1/onboarding"]);
      expect(calls[1]!.body).toMatchObject({ searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } });
      expect(calls[2]!.body).toMatchObject({ basedOnVersion: 1, masterCv: { fullName: "Marie Dupont", email: "marie.dupont@example.fr" } });
    });

    it("shows the Upgrade prompt in the thread when the Plan Quota refuses it, and creates nothing behind it", async () => {
      created = 409;
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of ["Marie Dupont", "Directrice financière", "Lyon"]) await user.type((await screen.findByLabelText("Votre réponse")), `${said}{Enter}`);
      expect(await within(thread()).findByText(/Vous avez atteint le nombre de profils/)).toBeTruthy();
      expect(calls).toHaveLength(1);
    });

    describe("the AI Coach leads the interview (#1002)", () => {
      beforeEach(() => {
        interviewCalls.length = 0;
      });

      it("asks one question at a time in the thread, challenges a vague answer, and the Profile is born at its target role and place", async () => {
        turns = [ROLE, { ...ROLE, challenge: "« Finance » est trop vague : quel intitulé de poste ?" }, PLACE, DONE];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.type(screen.getByLabelText("Votre message"), "Je n'ai pas de CV{Enter}");

        expect(await within(thread()).findByText("Quel poste recherchez-vous ?")).toBeTruthy();
        expect(interviewCalls[0]).toMatchObject({ language: "fr", exchange: [], opener: "Je n'ai pas de CV" });
        // Not optional: no « Passer », and an empty answer is refused.
        expect(screen.queryByRole("button", { name: "Passer cette question" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "Envoyer au coach" }));
        expect(screen.getByRole("alert").textContent).toMatch(/nécessaire/);

        await user.type(await screen.findByLabelText("Votre réponse"), "Finance{Enter}");
        expect(await within(thread()).findByText(/« Finance » est trop vague/)).toBeTruthy();
        expect(interviewCalls[1]).toMatchObject({ exchange: [{ ask: { field: "targetRole" }, reply: { kind: "answer", text: "Finance" } }] });
        await user.type(await screen.findByLabelText("Votre réponse"), "Directrice financière{Enter}");
        await within(thread()).findByText("Dans quelle ville souhaitez-vous travailler ?");
        expect(calls.filter((call) => call.url.startsWith("/api/profiles"))).toEqual([]);

        await user.type(await screen.findByLabelText("Votre réponse"), "Lyon{Enter}");
        await waitFor(() => expect(calls.filter((call) => call.url === "/api/profiles")).toHaveLength(1));
        expect(calls.find((call) => call.url === "/api/profiles")).toMatchObject({
          method: "POST",
          body: { onboarding: "in_progress", searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: [] }, masterCv: { headline: "Directrice financière" } },
        });
        expect(await screen.findByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeTruthy();
      });

      it("proposes a deduction as suggestions: « Oui, … » puts it in the Profile, and a choice by its options", async () => {
        turns = [PLACE, CONTRACT, ask("remoteWorkOptions", "Quel rythme de télétravail vous convient ?", { kind: "choice", choices: ["on_site", "hybrid", "full_remote"] }), DONE];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
        await user.type(await screen.findByLabelText("Votre réponse"), "Lyon{Enter}");

        expect(await within(thread()).findByText("Je propose : CDI. Un poste de direction est le plus souvent en CDI.")).toBeTruthy();
        const suggestions = within(conversation()).getByRole("group", { name: "Suggestions" });
        expect(within(suggestions).getAllByRole("button").map((button) => button.textContent)).toEqual(["Oui, CDI", "Non, plutôt…", "CDI", "CDD", "Indépendant (freelance)", "Intérim", "Passer cette question"]);
        await waitFor(() => expect(document.activeElement).toBe(within(suggestions).getByRole("button", { name: "Oui, CDI" })));
        await user.click(within(suggestions).getByRole("button", { name: "Oui, CDI" }));
        expect(await within(thread()).findByText("Oui, CDI")).toBeTruthy();

        await user.click(await screen.findByRole("button", { name: "Hybride" }));
        await screen.findByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" });
        expect(interviewCalls.at(-1)).toMatchObject({ draft: { searchCriteria: { contractTypes: ["cdi"], remoteWorkOptions: ["hybrid"] } } });
        // The review shows what was validated, the Profile born when target role and place are known.
        expect((within(reviewPane()).getByRole("checkbox", { name: "CDI" }) as HTMLInputElement).checked).toBe(true);
        expect((within(reviewPane()).getByRole("checkbox", { name: "Hybride" }) as HTMLInputElement).checked).toBe(true);
      });

      it("never puts a proposal refused or ignored in the Profile: « Non, plutôt… » hands over to the box", async () => {
        turns = [{ ...ROLE, proposal: { field: "targetRole", value: "Directrice financière", because: "Votre dernier poste.", shown: "Directrice financière" } }, CONTRACT, PLACE, DONE];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));

        await user.click(await screen.findByRole("button", { name: "Non, plutôt…" }));
        expect(document.activeElement).toBe(screen.getByLabelText("Votre réponse"));
        expect(screen.queryByRole("button", { name: "Oui, Directrice financière" })).toBeNull();
        await user.type(screen.getByLabelText("Votre réponse"), "Contrôleuse de gestion{Enter}");
        expect(await within(thread()).findByText("Contrôleuse de gestion")).toBeTruthy();

        // The CDI proposed, then ignored: the Candidate skips the question.
        await user.click(await screen.findByRole("button", { name: "Passer cette question" }));
        await user.type(await screen.findByLabelText("Votre réponse"), "Lyon{Enter}");
        await screen.findByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" });

        await waitFor(() => expect(calls.filter((call) => call.url === "/api/profiles")).toHaveLength(1));
        const born = calls.find((call) => call.url === "/api/profiles")!;
        expect(born.body).toMatchObject({ searchCriteria: { targetRole: "Contrôleuse de gestion", contractTypes: [] } });
        expect(JSON.stringify(calls)).not.toContain("Directrice financière");
        expect(JSON.stringify(calls)).not.toContain('"cdi"');
        expect(interviewCalls.at(-1)).toMatchObject({
          exchange: [
            { reply: { kind: "answer", text: "Contrôleuse de gestion", declined: true } },
            { proposal: { value: ["cdi"] }, reply: { kind: "skipped" } },
            { reply: { kind: "answer", text: "Lyon" } },
          ],
        });
      });

      it("saves a criterion validated after the Profile is born on it, through its Search Criteria", async () => {
        turns = [ROLE, PLACE, CONTRACT, DONE];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
        await user.type(await screen.findByLabelText("Votre réponse"), "Directrice financière{Enter}");
        await user.type(await screen.findByLabelText("Votre réponse"), "Lyon{Enter}");
        await user.click(await screen.findByRole("button", { name: "Oui, CDI" }));
        await waitFor(() => expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual(["POST /api/profiles", "PATCH /api/profiles/p1"]));
        expect(calls[1]!.body).toMatchObject({ searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"] } });
      });

      it("hands over to the scripted questions at the next question when the AI fails, not asking again what it knows", async () => {
        turns = [ROLE, PLACE, "down"];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
        await user.type(await screen.findByLabelText("Votre réponse"), "Directrice financière{Enter}");
        await user.type(await screen.findByLabelText("Votre réponse"), "Lyon{Enter}");

        expect(await within(thread()).findByText(/Je continue avec mes questions habituelles, sans l'IA/)).toBeTruthy();
        expect(within(thread()).getByText("Pour commencer, quels sont vos prénom et nom ?")).toBeTruthy();
        await user.type(await screen.findByLabelText("Votre réponse"), "Marie Dupont{Enter}");
        expect(await within(thread()).findByText("À quelle adresse e-mail les recruteurs peuvent-ils vous écrire ?")).toBeTruthy();
      });

      it("shows the interview in Activity: « Entretien d'accueil » with its model and tokens, no longer « Sans IA »", async () => {
        turns = [ROLE, PLACE];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
        await user.type(await screen.findByLabelText("Votre réponse"), "Directrice financière{Enter}");
        await within(thread()).findByText("Dans quelle ville souhaitez-vous travailler ?");

        const activity = screen.getByRole("complementary", { name: "Activité" });
        const row = within(activity).getByRole("button", { name: /Création du profil/ });
        expect(row.textContent).not.toMatch(/Sans IA/);
        await user.click(row);
        const detail = document.getElementById(row.getAttribute("aria-controls")!)!;
        expect(detail.textContent).toMatch(/Entretien d'accueil/);
        expect(detail.textContent).toMatch(/1 réponse/);
        expect(detail.textContent).toMatch(/Mistral/);
        expect(detail.textContent).not.toMatch(/Questionnaire d'accueil/);
      });
    });

    it("creates the Profile at the review's save from scratch, its onboarding done", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
      await user.type(within(reviewPane()).getByLabelText("Nom et prénom"), "Marie Dupont");
      await user.click(within(reviewPane()).getByRole("button", { name: "Enregistrer mon profil" }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ url: "/api/profiles", method: "POST", body: { onboarding: "done" } });
    });

    it("resumes a Profile not finished at its review, filled with what is saved, and finishes it", async () => {
      const user = userEvent.setup();
      const resumed = {
        id: "p1",
        version: 1,
        masterCv: { fullName: "Marie Dupont", headline: "Directrice financière", email: "", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: [], languages: [] },
        searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi" as const], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
      };
      renderInFrench(
        <AiActivityLiveProvider>
          <WorkPaneProvider version="1.2.3">
            <ProfileOnboarding resumed={resumed} />
            <WorkPane />
          </WorkPaneProvider>
        </AiActivityLiveProvider>,
      );
      expect(within(thread()).getByText(/Reprenons la création de votre profil/)).toBeTruthy();
      expect((within(reviewPane()).getByLabelText("Nom et prénom") as HTMLInputElement).value).toBe("Marie Dupont");
      expect((within(reviewPane()).getByRole("checkbox", { name: "CDI" }) as HTMLInputElement).checked).toBe(true);

      await user.click(within(reviewPane()).getByRole("button", { name: "Enregistrer mon profil" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/profils/p1"));
      expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual(["PATCH /api/profiles/p1", "POST /api/profiles/p1/onboarding"]);
      expect(calls[0]!.body).toMatchObject({ searchCriteria: { contractTypes: ["cdi"] } });
    });
  });

  describe("its Activity (#810): one entry « Création du profil », as the Candidate goes", () => {
    const activity = () => screen.getByRole("complementary", { name: "Activité" });
    const creation = async (user: ReturnType<typeof userEvent.setup>) => {
      const row = within(activity()).getByRole("button", { name: /Création du profil/ });
      if (row.getAttribute("aria-expanded") === "false") await user.click(row);
      return document.getElementById(row.getAttribute("aria-controls")!)!;
    };

    it("is empty before anything is done", () => {
      renderInFrench(<NewProfilePage />);
      expect(activity().textContent).toContain("Rien encore sur cette page.");
    });

    it("counts the questionnaire's answers, the questions written by Jobbbox, without AI", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      await user.type((await screen.findByLabelText("Votre réponse")), "Marie Dupont{Enter}");
      await user.type((await screen.findByLabelText("Votre réponse")), "Directrice financière{Enter}");

      const detail = await creation(user);
      expect(detail.textContent).toMatch(/Questionnaire d'accueilQuestions écrites par Jobbbox · 2 réponses · Sans IA/);
      expect(within(activity()).getByRole("button", { name: /Création du profil/ }).textContent).toMatch(/En cours · Sans IA/);
    });

    it("adds the review once opened, and forgets it all when the Candidate starts over", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
      expect((await creation(user)).textContent).toMatch(/RelecturePar vous · Sans IA/);

      await user.click(within(reviewPane()).getByRole("button", { name: "Importer un autre CV" }));
      await waitFor(() => expect(activity().textContent).toContain("Rien encore sur cette page."));
    });
  });
});
