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

const conversation = () => screen.getByRole("region", { name: "Créer un profil avec votre coach" });
const thread = () => screen.getByRole("list", { name: "Votre échange avec le coach" });
const reviewPane = () => screen.getByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" });

describe("creating a Profile is a conversation with the AI Coach (ADR-0070)", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
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

  it("asks the Questionnaire in the thread and takes the answers in the box at the foot", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));

    const box = screen.getByLabelText("Votre réponse");
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("rows")).toBe("1");
    expect(box.closest(".coach-panel-composer-inline")).toBeTruthy();
    expect(within(thread()).getByText(/Je vous pose mes questions une à une/)).toBeTruthy();
    expect(within(thread()).getByText("Répondre aux questions de mon coach")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "J'ai un CV" })).toBeNull();

    // A required question can't be left empty.
    await user.click(screen.getByRole("button", { name: "Envoyer au coach" }));
    expect(screen.getByRole("alert").textContent).not.toBe("");

    await user.type(box, "Marie Dupont{Enter}");
    expect(within(thread()).getByText("Marie Dupont")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Votre réponse"));
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
      if (said) await user.type(screen.getByLabelText("Votre réponse"), `${said}{Enter}`);
      else await user.click(screen.getByRole("button", { name: "Passer cette question" }));
    }
    await user.type(screen.getByRole("textbox", { name: "Votre réponse" }), "Non{Enter}");
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
    let calls: Call[];
    let created: number;
    let searches: number;

    beforeEach(() => {
      calls = [];
      created = 201;
      searches = 0;
      vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        // The Sectors' and Domains' labels: none here.
        if (url === "/api/reference-data") return new Response(null, { status: 404 });
        calls.push({ url, method: init.method ?? "GET", body: JSON.parse(String(init.body ?? "{}")) });
        if (url === "/api/profiles") return Response.json(created === 201 ? { id: "p1" } : { error: "plan_quota_reached", prompt: null }, { status: created });
        if (url === "/api/profiles/p1/onboarding") return Response.json({ id: "p1", version: 2 });
        if (url === "/api/profiles/p1/onboarding-search") {
          searches += 1;
          return searches > 2 ? Response.json({ error: "used_up" }, { status: 409 }) : Response.json({ id: `s${searches}`, offered: searches === 1 ? "first" : "restart" }, { status: 201 });
        }
        return Response.json({ id: "p1" });
      });
    });

    /** Answers the Questionnaire's first questions in the box, then skips each question left, to its review. */
    async function answerUpToReview(user: ReturnType<typeof userEvent.setup>, answers: string[]) {
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of answers) await user.type(screen.getByLabelText("Votre réponse"), `${said}{Enter}`);
      while (!screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })) {
        await user.click(screen.getByRole("button", { name: "Passer cette question" }));
      }
    }

    it("creates the Profile once the target role and location are answered, its onboarding in progress, starts its offered Job Search, then nothing more until the review", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      await user.type(screen.getByLabelText("Votre réponse"), "Marie Dupont{Enter}");
      await user.type(screen.getByLabelText("Votre réponse"), "Directrice financière{Enter}");
      expect(calls).toEqual([]);

      await user.type(screen.getByLabelText("Votre réponse"), "Lyon{Enter}");
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toMatchObject({ url: "/api/profiles/p1/onboarding-search", method: "POST" });
      expect(calls[0]).toMatchObject({
        url: "/api/profiles",
        method: "POST",
        body: {
          onboarding: "in_progress",
          searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] },
          masterCv: { fullName: "Marie Dupont", headline: "Directrice financière", location: "Lyon", email: "" },
        },
      });

      await user.type(screen.getByLabelText("Votre réponse"), "marie.dupont@example.fr{Enter}");
      expect(calls).toHaveLength(2);

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
      expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual([
        "POST /api/profiles",
        "POST /api/profiles/p1/onboarding-search",
        "PATCH /api/profiles/p1",
        "POST /api/profiles/p1/onboarding",
      ]);
      expect(calls[2]!.body).toMatchObject({ searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } });
      expect(calls[3]!.body).toMatchObject({ basedOnVersion: 1, masterCv: { fullName: "Marie Dupont", email: "marie.dupont@example.fr" } });
    });

    it("tells in the thread that the offered Job Search started, with its link, and starts it again once when the target role changes (#1000)", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon"]);

      expect(await within(thread()).findByText(/je lance dès maintenant une première recherche d'offres, offerte/)).toBeTruthy();
      expect(within(thread()).getByRole("link", { name: "Voir la recherche" }).getAttribute("href")).toBe("/recherches/s1");

      // Started over, another target role: its Search Criteria changed, the search started again, offered too.
      await user.click(within(reviewPane()).getByRole("button", { name: "Recommencer" }));
      await answerUpToReview(user, ["Marie Dupont", "Contrôleuse de gestion", "Lyon"]);
      expect(await within(thread()).findByText(/je relance la recherche, offerte elle aussi/)).toBeTruthy();
      expect(within(thread()).getByRole("link", { name: "Voir la recherche" }).getAttribute("href")).toBe("/recherches/s2");

      // A third change asks for nothing more: the restart is spent.
      await user.click(within(reviewPane()).getByRole("button", { name: "Recommencer" }));
      await answerUpToReview(user, ["Marie Dupont", "Comptable", "Lyon"]);
      await waitFor(() => expect(calls.filter((call) => call.url === "/api/profiles/p1" && call.method === "PATCH")).toHaveLength(2));
      expect(calls.filter((call) => call.url === "/api/profiles/p1/onboarding-search")).toHaveLength(2);
      expect(within(thread()).queryByRole("link", { name: "Voir la recherche" })).toBeNull();
    });

    it("goes on without a word when the offered Job Search cannot start (#1000)", async () => {
      searches = 2;
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of ["Marie Dupont", "Directrice financière", "Lyon"]) await user.type(screen.getByLabelText("Votre réponse"), `${said}{Enter}`);
      await waitFor(() => expect(calls.map((call) => call.url)).toEqual(["/api/profiles", "/api/profiles/p1/onboarding-search"]));
      expect(within(thread()).queryByRole("link", { name: "Voir la recherche" })).toBeNull();
      expect(screen.getByLabelText("Votre réponse")).toBeTruthy();
    });

    it("shows the Upgrade prompt in the thread when the Plan Quota refuses it, and creates nothing behind it", async () => {
      created = 409;
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of ["Marie Dupont", "Directrice financière", "Lyon"]) await user.type(screen.getByLabelText("Votre réponse"), `${said}{Enter}`);
      expect(await within(thread()).findByText(/Vous avez atteint le nombre de profils/)).toBeTruthy();
      expect(calls).toHaveLength(1);
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
      await user.type(screen.getByLabelText("Votre réponse"), "Marie Dupont{Enter}");
      await user.type(screen.getByLabelText("Votre réponse"), "Directrice financière{Enter}");

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
