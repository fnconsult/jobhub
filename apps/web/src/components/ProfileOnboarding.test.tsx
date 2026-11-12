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
/** The summary's card in the thread (#1004). */
const summary = () => within(thread()).getByRole("region", { name: "Votre recherche d'offres" });

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

  it("sums up the draft first (#1004), the review form opened in the Work Pane by « Voir le détail », what is changed there shown in the summary", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));

    // The summary, not the form: an empty draft says so.
    expect(within(thread()).getByText("Presque fini")).toBeTruthy();
    expect(within(thread()).getByText("Voici comment je comprends ce que vous recherchez. Ai-je bien compris ?")).toBeTruthy();
    expect(summary().textContent).toMatch(/Je ne sais encore rien de ce que vous recherchez/);
    expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Relire et enregistrer" })).toBeNull();

    await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
    await user.type(within(reviewPane()).getByLabelText("Nom et prénom"), "Marie Dupont");
    await user.type(within(reviewPane()).getByLabelText("Poste recherché"), "Comptable");
    await user.click(within(reviewPane()).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull());
    expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Comptable.");
    expect(within(summary()).getByText("Comptable").tagName).toBe("STRONG");

    // Opened again, it keeps what was changed; « Modifier » opens it too until #1005.
    await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
    expect((within(reviewPane()).getByLabelText("Nom et prénom") as HTMLInputElement).value).toBe("Marie Dupont");
  });

  it("starts over from the review: the two paths again, the pane closed", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
    await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
    await user.click(within(reviewPane()).getByRole("button", { name: "Importer un autre CV" }));

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull());
    expect(within(thread()).getByRole("heading", { name: "J'ai un CV" })).toBeTruthy();
  });

  describe("the Profile born at its target role and location (ADR-0105, #999)", () => {
    type Call = { url: string; method: string; body: Record<string, unknown> };
    let calls: Call[];
    let created: number;

    beforeEach(() => {
      calls = [];
      created = 201;
      vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        // The Sectors' and Domains' labels: none here.
        if (url === "/api/reference-data") return new Response(null, { status: 404 });
        calls.push({ url, method: init.method ?? "GET", body: JSON.parse(String(init.body ?? "{}")) });
        if (url === "/api/profiles") return Response.json(created === 201 ? { id: "p1" } : { error: "plan_quota_reached", prompt: null }, { status: created });
        if (url === "/api/profiles/p1/onboarding") return Response.json({ id: "p1", version: 2 });
        return Response.json({ id: "p1" });
      });
    });

    /** Answers the Questionnaire's first questions in the box, then skips each question left, to its review. */
    async function answerUpToReview(user: ReturnType<typeof userEvent.setup>, answers: string[]) {
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of answers) await user.type(screen.getByLabelText("Votre réponse"), `${said}{Enter}`);
      while (!within(thread()).queryByRole("region", { name: "Votre recherche d'offres" })) {
        await user.click(screen.getByRole("button", { name: "Passer cette question" }));
      }
    }

    it("creates the Profile once the target role and location are answered, its onboarding in progress, then nothing more until the review", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      await user.type(screen.getByLabelText("Votre réponse"), "Marie Dupont{Enter}");
      await user.type(screen.getByLabelText("Votre réponse"), "Directrice financière{Enter}");
      expect(calls).toEqual([]);

      await user.type(screen.getByLabelText("Votre réponse"), "Lyon{Enter}");
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

      await user.type(screen.getByLabelText("Votre réponse"), "marie.dupont@example.fr{Enter}");
      expect(calls).toHaveLength(1);

      // Its Activity says « Profil créé » as soon as it is born, still « En cours ».
      const activity = screen.getByRole("complementary", { name: "Activité" });
      const row = within(activity).getByRole("button", { name: /Création du profil/ });
      await user.click(row);
      expect(document.getElementById(row.getAttribute("aria-controls")!)!.textContent).toMatch(/Profil créé/);
    });

    it("« Cela semble correct » saves the summary on the Profile born: its Search Criteria, then one Master CV Version that finishes it (#1004)", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon", "marie.dupont@example.fr"]);
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière à Lyon.");
      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));

      // The coach says it is saved, in the thread; the Candidate goes on to the Profile when they choose.
      const toProfile = await within(thread()).findByRole("link", { name: "Continuer vers mon profil" });
      expect(toProfile.getAttribute("href")).toBe("/profils/p1");
      expect(document.activeElement).toBe(toProfile);
      expect(within(thread()).getByText(/C'est noté : votre profil est enregistré/)).toBeTruthy();
      expect(within(summary()).queryByRole("button", { name: "Cela semble correct" })).toBeNull();
      expect(push).not.toHaveBeenCalled();
      expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual(["POST /api/profiles", "PATCH /api/profiles/p1", "POST /api/profiles/p1/onboarding"]);
      expect(calls[1]!.body).toMatchObject({ searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } });
      expect(calls[2]!.body).toMatchObject({ basedOnVersion: 1, masterCv: { fullName: "Marie Dupont", email: "marie.dupont@example.fr" } });
    });

    it("saves what was changed in « Voir le détail », and the form's own « Enregistrer mon profil » still saves it", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon"]);
      await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
      await user.click(within(reviewPane()).getByRole("checkbox", { name: "CDI" }));
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière en CDI à Lyon.");

      await user.click(within(reviewPane()).getByRole("button", { name: "Enregistrer mon profil" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/profils/p1"));
      expect(calls[1]!.body).toMatchObject({ searchCriteria: { contractTypes: ["cdi"] } });
    });

    it("says in the summary's card which fields to correct when the save refuses them", async () => {
      vi.stubGlobal("fetch", async (url: string) => {
        if (url === "/api/reference-data") return new Response(null, { status: 404 });
        return Response.json({ errors: [{ field: "searchCriteria.targetRole", code: "required" }] }, { status: 400 });
      });
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));
      expect((await within(summary()).findByRole("alert")).textContent).toBe(
        "Certains champs sont à compléter ou à corriger : Poste recherché. Corrigez-les dans « Voir le détail ».",
      );
      expect(within(summary()).getByRole("button", { name: "Cela semble correct" })).toBeTruthy();
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
      await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
      await user.type(within(reviewPane()).getByLabelText("Nom et prénom"), "Marie Dupont");
      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ url: "/api/profiles", method: "POST", body: { onboarding: "done", masterCv: { fullName: "Marie Dupont" } } });
      // Saved, the review form closes.
      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull());
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
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière en CDI à Lyon.");
      await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
      expect((within(reviewPane()).getByLabelText("Nom et prénom") as HTMLInputElement).value).toBe("Marie Dupont");
      expect((within(reviewPane()).getByRole("checkbox", { name: "CDI" }) as HTMLInputElement).checked).toBe(true);

      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));
      expect(await within(thread()).findByRole("link", { name: "Continuer vers mon profil" })).toBeTruthy();
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

      await user.click(within(screen.getByRole("group", { name: "Suggestions" })).getByRole("button", { name: "Importer un autre CV" }));
      await waitFor(() => expect(activity().textContent).toContain("Rien encore sur cette page."));
    });
  });
});
