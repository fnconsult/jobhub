// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityContent, AiActivityProvider } from "./AiActivity";
import { AiActivityLiveProvider } from "./AiActivityLive";
import { EnCeMoment } from "./EnCeMoment";
import { JobSearchNotifications } from "./JobSearchNotifications";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/profils/nouveau", useRouter: () => ({ push, refresh: vi.fn() }) }));

/** /profils/nouveau: the conversation in the page, the Work Pane beside it, and its Activity (#810), fed by the Job Search poll. */
function NewProfilePage() {
  return (
    <AiActivityLiveProvider>
      <JobSearchNotifications initial={{ notifications: [], searching: false, running: [] }} everyMs={20} />
      <AiActivityProvider>
        <WorkPaneProvider version="1.2.3">
          <main>
            <ProfileOnboarding />
          </main>
          <WorkPane />
          <aside aria-label="Activité">
            <EnCeMoment />
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
/** The summary's card in the thread (#1004). */
const summary = () => within(thread()).getByRole("region", { name: "Votre recherche d'offres" });

describe("creating a Profile is a conversation with the AI Coach (ADR-0070)", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    // The AI unavailable: the scripted questions (#1002's fallback), unless a test says otherwise.
    vi.stubGlobal("fetch", async (url: string) => (url === "/api/onboarding/interview" ? interviewReply([]) : new Response(null, { status: 404 })));
  });
  afterEach(() => {
    // Unmounted first: AI Activity's Job Search poll renders nothing more once the stubs are gone.
    cleanup();
    vi.unstubAllGlobals();
  });

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
    // Not the help greeting of the other conversations: this page's box answers no question from the help (#997).
    expect(welcome.textContent).not.toMatch(/Posez votre question/);
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

  it("sums up the draft first (#1004), the review form opened in the Work Pane by « Voir le détail », what is changed there shown in the summary", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));

    // The summary, not the form: an empty draft says so.
    expect(within(thread()).queryByText("Presque fini")).toBeNull();
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

    // Opened again, it keeps what was changed.
    await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
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

  describe("the Profile born at its target role and location (ADR-0106, #999)", () => {
    type Call = { url: string; method: string; body: Record<string, unknown> };
    const interviewCalls: Record<string, unknown>[] = [];
    let calls: Call[];
    let created: number;
    let turns: (object | "down")[];
    let searches: number;
    let polled: string[];
    const measures = {
      step: "search",
      sources: [
        { source: "france_travail", state: "searched" },
        { source: "web_search", state: "searching" },
      ],
      pagesRead: 3,
      offersAnalysed: 2,
      matched: null,
    };
    const activity = () => screen.getByRole("complementary", { name: "Activité" });
    const now = () => within(activity()).getByRole("region", { name: "En ce moment" });

    beforeEach(() => {
      calls = [];
      polled = [];
      created = 201;
      turns = [];
      searches = 0;
      vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        // The Sectors' and Domains' labels: none here.
        if (url === "/api/reference-data") return new Response(null, { status: 404 });
        if (url === "/api/onboarding/interview") {
          interviewCalls.push(JSON.parse(String(init.body)));
          return interviewReply(turns);
        }
        // AI Activity's poll (#1001): the offered Job Search, searching, its run's measures; then the Job Offers it found.
        if (url === "/api/job-searches/notifications") {
          polled.push(url);
          const running = searches > 0 ? [{ jobSearchId: `s${searches}`, profile: { id: "p1", name: "Directrice financière" }, startedAt: new Date().toISOString(), steps: [], live: measures }] : [];
          return Response.json({ notifications: [], searching: running.length > 0, running });
        }
        if (url.startsWith("/api/job-searches/")) {
          polled.push(url);
          return Response.json({
            id: "s1",
            status: "searching",
            failure: null,
            live: { ...measures, jobOfferIds: ["o1", "o2"] },
            jobOffers: url.includes("known=")
              ? []
              : [
                  { id: "o1", title: "DAF", content: "Directrice financière à Lyon.", location: "Lyon", contractType: "cdi" },
                  { id: "o2", title: "DAF", content: "Directrice financière à Lyon.", location: "Lyon", contractType: "cdd" },
                ],
          });
        }
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
      for (const said of answers) await user.type((await screen.findByLabelText("Votre réponse")), `${said}{Enter}`);
      while (!within(thread()).queryByRole("region", { name: "Votre recherche d'offres" })) {
        await user.click(screen.getByRole("button", { name: "Passer cette question" }));
      }
    }

    it("creates the Profile once the target role and location are answered, its onboarding in progress, starts its offered Job Search, then nothing more until the review", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      await user.type((await screen.findByLabelText("Votre réponse")), "Marie Dupont{Enter}");
      await user.type((await screen.findByLabelText("Votre réponse")), "Directrice financière{Enter}");
      expect(calls).toEqual([]);

      await user.type((await screen.findByLabelText("Votre réponse")), "Lyon{Enter}");
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

      await user.type((await screen.findByLabelText("Votre réponse")), "marie.dupont@example.fr{Enter}");
      expect(calls).toHaveLength(2);

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
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière ; lieu : Lyon.");
      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));

      // The coach says it is saved, in the thread; the Candidate goes on to the Profile when they choose.
      const toProfile = await within(thread()).findByRole("link", { name: "Continuer vers mon profil" });
      expect(toProfile.getAttribute("href")).toBe("/profils/p1");
      expect(document.activeElement).toBe(toProfile);
      expect(within(thread()).getByText(/C'est noté : votre profil est enregistré/)).toBeTruthy();
      expect(within(summary()).queryByRole("button", { name: "Cela semble correct" })).toBeNull();
      expect(push).not.toHaveBeenCalled();
      expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual([
        "POST /api/profiles",
        "POST /api/profiles/p1/onboarding-search",
        "PATCH /api/profiles/p1",
        "POST /api/profiles/p1/onboarding",
      ]);
      expect(calls[2]!.body).toMatchObject({ searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] } });
      expect(calls[3]!.body).toMatchObject({ basedOnVersion: 1, masterCv: { fullName: "Marie Dupont", email: "marie.dupont@example.fr" } });

      // Written to the coach once saved: it sends the Candidate on to the Profile, no longer back to a review.
      await user.type(screen.getByLabelText("Votre message"), "Et maintenant ?{Enter}");
      expect(await within(thread()).findByText(/Votre profil est enregistré : cliquez sur « Continuer vers mon profil »/)).toBeTruthy();
      expect(within(thread()).queryByText(/relisez-le, corrigez ce qu'il faut et enregistrez-le/)).toBeNull();
    });

    it("tells in the thread that the offered Job Search started, in one line, and starts it again once when the target role changes (#1000)", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon"]);

      const line = await within(thread()).findByText(/je lance dès maintenant une première recherche d'offres, offerte/);
      // Text only, no card of its own: its progress is in Activity (#1001).
      expect(line.closest(".chat-coach")).toBeTruthy();
      expect(within(thread()).queryByRole("link", { name: "Ouvrir la recherche" })).toBeNull();
      expect(thread().querySelector(".ds-stats, .ds-stepper")).toBeNull();

      // Started over, another target role: its Search Criteria changed, the search started again, offered too.
      await user.click(screen.getByRole("button", { name: "Recommencer" }));
      await answerUpToReview(user, ["Marie Dupont", "Contrôleuse de gestion", "Lyon"]);
      expect(await within(thread()).findByText(/je relance la recherche, offerte elle aussi/)).toBeTruthy();

      // A third change asks for nothing more: the restart is spent.
      await user.click(screen.getByRole("button", { name: "Recommencer" }));
      await answerUpToReview(user, ["Marie Dupont", "Comptable", "Lyon"]);
      await waitFor(() => expect(calls.filter((call) => call.url === "/api/profiles/p1" && call.method === "PATCH")).toHaveLength(2));
      expect(calls.filter((call) => call.url === "/api/profiles/p1/onboarding-search")).toHaveLength(2);
    });

    it("shows the offered Job Search « ici » in Activity's « En ce moment », with its run's measures and the Job Offers matching its criteria (#1001)", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of ["Marie Dupont", "Directrice financière", "Lyon"]) await user.type((await screen.findByLabelText("Votre réponse")), `${said}{Enter}`);

      // Asked at once, the page unchanged; then the Job Offers found, once the run says it analysed some.
      const entry = await within(now()).findByRole("article", { name: "Recherche d'offres · Directrice financière" });
      expect(polled[0]).toBe("/api/job-searches/notifications");
      await waitFor(() => expect(polled).toContain("/api/job-searches/s1/live"));
      expect(within(now()).queryByText("Rien ne tourne sur cette page.")).toBeNull();

      const stats = entry.querySelector<HTMLElement>(".ds-stats[aria-label='Ce que la recherche a mesuré']")!;
      const figure = (label: string) => within(stats).getByText(label).parentElement!.querySelector(".ds-stat__value")!.textContent;
      expect(figure("sources consultées")).toBe("2 sur 2");
      expect(figure("pages lues")).toBe("3");
      expect(figure("offres analysées")).toBe("2");
      // Counted by the page, by Match Score against the Search Criteria of the moment: the CDD one too, no contract asked yet.
      await waitFor(() => expect(figure("offres qui vous correspondent")).toBe("2"));
      const sources = within(entry).getByRole("list", { name: "Sources de la recherche" });
      expect(within(sources).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["France Travail · consultée", "Recherche web · en cours…"]);
      expect(sources.querySelector(".ds-status[data-tone='success']")).toBeTruthy();
      expect(within(entry).getByRole("list", { name: "Étapes de la recherche" })).toBeTruthy();
      expect(within(entry).getByText(/Affinée avec :/).textContent).toBe("Affinée avec : Directrice financière · Lyon");

    });

    it("closes the review without leaving the page: no new load of it, which would meet the Plan Quota the Profile born counts in", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon"]);
      await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
      await user.click(within(reviewPane()).getByRole("button", { name: "Fermer" }));
      await waitFor(() => expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull());
      expect(push).not.toHaveBeenCalled();
      // The thread is still there, with the coach's line on the search.
      expect(within(thread()).getByText(/je lance dès maintenant une première recherche d'offres/)).toBeTruthy();
      // No card above the summary any more (#1001).
      expect(within(thread()).queryByRole("list", { name: "Étapes de la recherche" })).toBeNull();
    });

    it("goes on without a word when the offered Job Search cannot start (#1000)", async () => {
      searches = 2;
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of ["Marie Dupont", "Directrice financière", "Lyon"]) await user.type((await screen.findByLabelText("Votre réponse")), `${said}{Enter}`);
      await waitFor(() => expect(calls.map((call) => call.url)).toEqual(["/api/profiles", "/api/profiles/p1/onboarding-search"]));
      expect(within(thread()).queryByRole("link", { name: "Voir la recherche" })).toBeNull();
      expect(screen.getByLabelText("Votre réponse")).toBeTruthy();
    });

    it("saves what was changed in « Voir le détail », and the form's own « Enregistrer mon profil » still saves it", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await answerUpToReview(user, ["Marie Dupont", "Directrice financière", "Lyon"]);
      await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
      await user.click(within(reviewPane()).getByRole("checkbox", { name: "CDI" }));
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière en CDI ; lieu : Lyon.");

      await user.click(within(reviewPane()).getByRole("button", { name: "Enregistrer mon profil" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/profils/p1"));
      expect(calls.find((call) => call.method === "PATCH")!.body).toMatchObject({ searchCriteria: { contractTypes: ["cdi"] } });
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
        expect(await within(thread()).findByRole("region", { name: "Votre recherche d'offres" })).toBeTruthy();
      });

      it("never offers « Passer » on the target role or the place, even asked again after a vague answer and said optional by the AI", async () => {
        const optionally = (turn: { ask: object }) => ({ ...turn, ask: { ...turn.ask, optional: true } });
        turns = [optionally(ROLE), { ...optionally(ROLE), challenge: "« Finance » est trop vague : quel intitulé de poste ?" }, optionally(PLACE), DONE];
        const user = userEvent.setup();
        renderInFrench(<NewProfilePage />);
        await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));

        await within(thread()).findByText("Quel poste recherchez-vous ?");
        expect(screen.queryByRole("button", { name: "Passer cette question" })).toBeNull();
        await user.type(await screen.findByLabelText("Votre réponse"), "Finance{Enter}");
        expect(await within(thread()).findByText(/« Finance » est trop vague/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Passer cette question" })).toBeNull();
        // An empty answer is refused, not taken as skipped.
        await user.click(screen.getByRole("button", { name: "Envoyer au coach" }));
        expect(screen.getByRole("alert").textContent).toMatch(/nécessaire/);
        expect(interviewCalls).toHaveLength(2);

        await user.type(await screen.findByLabelText("Votre réponse"), "Directrice financière{Enter}");
        await within(thread()).findByText("Dans quelle ville souhaitez-vous travailler ?");
        expect(screen.queryByRole("button", { name: "Passer cette question" })).toBeNull();
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
        await within(thread()).findByRole("region", { name: "Votre recherche d'offres" });
        expect(interviewCalls.at(-1)).toMatchObject({ draft: { searchCriteria: { contractTypes: ["cdi"], remoteWorkOptions: ["hybrid"] } } });
        // The review shows what was validated, the Profile born when target role and place are known.
        await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
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
        await within(thread()).findByRole("region", { name: "Votre recherche d'offres" });

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
        // The search in « En ce moment » counts the CDI proposed, « (supposé) » until it is validated (#1001).
        const card = await within(now()).findByRole("article", { name: "Recherche d'offres · Directrice financière" });
        await waitFor(() => expect(within(card).getByText(/Affinée avec :/).textContent).toBe("Affinée avec : Directrice financière · Lyon · CDI (supposé)"));
        await user.click(await screen.findByRole("button", { name: "Oui, CDI" }));
        await waitFor(() =>
          expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual(["POST /api/profiles", "POST /api/profiles/p1/onboarding-search", "PATCH /api/profiles/p1"]),
        );
        expect(calls[2]!.body).toMatchObject({ searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: ["cdi"] } });
        // Validated, it narrows the search: in « Affinée avec », no longer supposed; the search is not started again.
        await waitFor(() => expect(within(card).getByText(/Affinée avec :/).textContent).toBe("Affinée avec : Directrice financière · Lyon · CDI"));
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

    describe("from a CV (#1003): « Profil en construction », then the interview from what it read", () => {
      const READ_CV = {
        masterCv: {
          fullName: "Marie Dupont",
          headline: "Directrice financière",
          email: "marie.dupont@example.fr",
          phone: "",
          location: "Lyon",
          summary: "",
          experience: [{ title: "DAF", employer: "Groupe Seb", location: "Lyon", period: "2015 – 2024", description: "" }],
          education: [],
          skills: ["Consolidation", "IFRS", "Trésorerie", "Contrôle de gestion", "SAP", "Management", "Fiscalité"],
          languages: [],
        },
        searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] },
        provenance: { v: 1, steps: [{ kind: "ai", activity: "read", task: "cv_parsing", provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-medium-2508", ms: 900, at: new Date().toISOString(), outcome: "ok", count: 1 }], sites: [], startedAt: new Date().toISOString(), wallMs: 900 },
      };
      let readCv: (draft: object) => void;
      /** Whether the device lets things move (prefers-reduced-motion: no-preference). */
      let motion: boolean;
      const card = () => within(thread()).getByRole("region", { name: "Profil en construction" });

      beforeEach(() => {
        interviewCalls.length = 0;
        motion = true;
        // The folded line's glyph measures its strokes, which jsdom cannot.
        Object.assign(SVGElement.prototype, { getTotalLength: () => 10, getPointAtLength: () => ({ x: 12, y: 12 }) });
        vi.stubGlobal("matchMedia", (query: string) => ({ matches: motion && query.includes("no-preference"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
        const inner = globalThis.fetch;
        vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
          url === "/api/cv/draft" ? new Promise<Response>((resolve) => (readCv = (draft) => resolve(new Response(`${JSON.stringify({ type: "done", ...draft })}\n`, { headers: { "content-type": "application/x-ndjson" } })))) : inner(url, init),
        );
        vi.useFakeTimers({ shouldAdvanceTime: true });
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      async function uploadCv(user: ReturnType<typeof userEvent.setup>) {
        await user.upload(screen.getByLabelText("Votre CV"), new File(["%PDF"], "cv.pdf", { type: "application/pdf" }));
        await user.click(screen.getByRole("button", { name: "Lire mon CV" }));
      }

      it("shows the step under way while the CV is read, then the fields read one by one, an absent one said absent, and folds into one line", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        turns = [{ ...ROLE, proposal: { field: "targetRole", value: "Directrice financière", because: "C'est ce que j'ai lu dans votre CV.", shown: "Directrice financière" } }];
        renderInFrench(<NewProfilePage />);
        await uploadCv(user);

        const reading = await within(thread()).findByRole("list", { name: "Profil en construction" });
        expect(within(reading).getByRole("listitem").getAttribute("aria-current")).toBe("step");
        expect(within(reading).getByRole("listitem").textContent).toMatch(/Lecture de votre profil \(en cours\)/);
        expect(within(card()).queryByRole("term")).toBeNull();

        readCv(READ_CV);
        await waitFor(() => expect(within(card()).getByText("Poste visé")).toBeTruthy());
        expect(within(card()).getAllByRole("term").map((term) => term.textContent)).toEqual(["Poste visé"]);
        await vi.advanceTimersByTimeAsync(350 * 5);
        expect(within(card()).getAllByRole("term")).toHaveLength(6);
        const values = within(card()).getAllByRole("definition").map((value) => value.textContent);
        expect(values).toEqual(["Directrice financière", "9 ans", "Lyon", "Consolidation, IFRS, Trésorerie, Contrôle de gestion, SAP et 2 autres", "Pas encore dans votre profil", "Pas encore dans votre profil"]);
        expect(within(card()).getAllByText("Pas encore dans votre profil")[0]!.tagName).toBe("EM");
        expect(within(card()).getByRole("listitem").getAttribute("aria-current")).toBeNull();

        // Shown a while, then folded as the interview starts.
        await vi.advanceTimersByTimeAsync(1200 + 350);
        await waitFor(() => expect(within(thread()).queryByRole("region", { name: "Profil en construction" })).toBeNull());
        const line = within(thread()).getByText("Profil construit à partir de votre CV · 4 informations lues");
        expect(line.closest("details")).toBeTruthy();
        expect(await within(thread()).findByText("Je propose : Directrice financière. C'est ce que j'ai lu dans votre CV.")).toBeTruthy();
      });

      it("shows the fields all at once under prefers-reduced-motion", async () => {
        motion = false;
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        renderInFrench(<NewProfilePage />);
        await uploadCv(user);
        await within(thread()).findByRole("region", { name: "Profil en construction" });
        readCv(READ_CV);
        await waitFor(() => expect(within(card()).getByText("Poste visé")).toBeTruthy());
        expect(within(card()).getAllByRole("term")).toHaveLength(6);
      });

      it("starts the interview from the CV's draft: the role and place to confirm, the Profile born at them with what read it, then only what a CV does not say", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const because = "C'est ce que j'ai lu dans votre CV.";
        turns = [
          { ...ROLE, proposal: { field: "targetRole", value: "Directrice financière", because, shown: "Directrice financière" } },
          { ...PLACE, proposal: { field: "locations", value: ["Lyon"], because, shown: "Lyon" } },
          CONTRACT,
          DONE,
        ];
        renderInFrench(<NewProfilePage />);
        await uploadCv(user);
        await within(thread()).findByRole("region", { name: "Profil en construction" });
        readCv(READ_CV);
        await vi.advanceTimersByTimeAsync(350 * 6 + 1200);

        await screen.findByRole("button", { name: "Oui, Directrice financière" });
        expect(interviewCalls[0]).toMatchObject({
          exchange: [],
          cv: { targetRole: "Directrice financière", locations: ["Lyon"] },
          draft: { masterCv: { skills: READ_CV.masterCv.skills, experience: READ_CV.masterCv.experience }, searchCriteria: { targetRole: "", locations: [] } },
        });
        expect(interviewCalls[0]).not.toHaveProperty("opener");
        // No candidate's opening line: the coach says it read the CV.
        expect(within(thread()).getByText(/J'ai lu votre CV/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Passer cette question" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "Oui, Directrice financière" }));
        await user.click(await screen.findByRole("button", { name: "Oui, Lyon" }));

        await waitFor(() => expect(calls.filter((call) => call.url === "/api/profiles")).toHaveLength(1));
        expect(calls.find((call) => call.url === "/api/profiles")).toMatchObject({
          body: { onboarding: "in_progress", searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"] }, masterCv: { fullName: "Marie Dupont", skills: READ_CV.masterCv.skills }, provenance: { steps: [{ task: "cv_parsing" }] } },
        });
        await user.click(await screen.findByRole("button", { name: "Passer cette question" }));
        await within(thread()).findByRole("region", { name: "Votre recherche d'offres" });
        // The CV's line and the exchange stay in the thread at the summary.
        expect(within(thread()).getByText("Profil construit à partir de votre CV · 4 informations lues")).toBeTruthy();
        expect(within(thread()).getByText("Oui, Lyon")).toBeTruthy();
      });
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
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière en CDI ; lieu : Lyon.");
      await user.click(within(summary()).getByRole("button", { name: "Voir le détail" }));
      expect((within(reviewPane()).getByLabelText("Nom et prénom") as HTMLInputElement).value).toBe("Marie Dupont");
      expect((within(reviewPane()).getByRole("checkbox", { name: "CDI" }) as HTMLInputElement).checked).toBe(true);

      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));
      expect(await within(thread()).findByRole("link", { name: "Continuer vers mon profil" })).toBeTruthy();
      expect(calls.map(({ url, method }) => `${method} ${url}`)).toEqual(["PATCH /api/profiles/p1", "POST /api/profiles/p1/onboarding"]);
      expect(calls[0]!.body).toMatchObject({ searchCriteria: { contractTypes: ["cdi"] } });
    });
  });

  describe("« Modifier »: the summary rewritten in the Candidate's words, translated by the AI into changes to validate (#1005)", () => {
    type Call = { url: string; method: string; body: Record<string, unknown> };
    let calls: Call[];
    /** What the AI route answers: its status and body. */
    let understood: { status: number; body: Record<string, unknown> };
    const provenance = {
      v: 1,
      steps: [
        {
          kind: "ai",
          activity: "think_write",
          ms: 900,
          at: "2026-11-12T10:00:00.000Z",
          outcome: "success",
          count: 1,
          task: "coaching",
          provider: "mistral",
          endpoint: "api.eu.mistral.ai",
          model: "mistral-medium-3-5",
          tokens: { input: 300, output: 40 },
        },
      ],
      sites: [{ kind: "candidate", links: [] }],
      startedAt: "2026-11-12T10:00:00.000Z",
      wallMs: 900,
    };

    beforeEach(() => {
      calls = [];
      understood = {
        status: 200,
        body: {
          searchCriteria: { targetRole: "Directrice financière", locations: ["Paris (75)"], contractTypes: ["cdd"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
          changed: ["locations", "contractTypes"],
          other: false,
          provenance,
        },
      };
      vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        if (url === "/api/reference-data") return new Response(null, { status: 404 });
        calls.push({ url, method: init.method ?? "GET", body: JSON.parse(String(init.body ?? "{}")) });
        if (url === "/api/onboarding/summary-changes") return Response.json(understood.body, { status: understood.status });
        if (url === "/api/profiles") return Response.json({ id: "p1" }, { status: 201 });
        if (url === "/api/profiles/p1/onboarding") return Response.json({ id: "p1", version: 2 });
        return Response.json({ id: "p1" });
      });
    });

    /** Up to the summary, by the Questionnaire: « Vous recherchez un poste de Directrice financière ; lieu : Lyon. » */
    async function toSummary(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));
      for (const said of ["Marie Dupont", "Directrice financière", "Lyon"]) await user.type(screen.getByLabelText("Votre réponse"), `${said}{Enter}`);
      while (!within(thread()).queryByRole("region", { name: "Votre recherche d'offres" })) {
        await user.click(screen.getByRole("button", { name: "Passer cette question" }));
      }
    }
    const textBox = () => within(summary()).getByRole("textbox", { name: "Votre recherche d'offres, avec vos mots" }) as HTMLTextAreaElement;
    const asked = () => calls.filter((call) => call.url === "/api/onboarding/summary-changes");

    it("puts the card in « Modification », the summary as plain text; « Annuler » changes nothing and asks no AI", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await toSummary(user);
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));

      expect(within(summary()).getByText("Modification")).toBeTruthy();
      expect(within(summary()).getByText("Écrivez-le comme vous l'expliqueriez à un recruteur.")).toBeTruthy();
      expect(textBox().value).toBe("Vous recherchez un poste de Directrice financière ; lieu : Lyon.");
      expect(document.activeElement).toBe(textBox());
      // The detail form does not open.
      expect(screen.queryByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" })).toBeNull();

      await user.type(textBox(), " Et en CDD.");
      await user.click(within(summary()).getByRole("button", { name: "Annuler" }));
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière ; lieu : Lyon.");
      expect(within(summary()).queryByRole("textbox")).toBeNull();
      expect(document.activeElement).toBe(within(summary()).getByRole("button", { name: "Modifier" }));
      expect(asked()).toEqual([]);
    });

    it("« Terminé » shows the changes understood, made once validated: the summary composed again and asked again, then saved", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await toSummary(user);
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
      await user.clear(textBox());
      await user.type(textBox(), "Je cherche un poste de Directrice financière en CDD, à Paris plutôt qu'à Lyon.");
      await user.click(within(summary()).getByRole("button", { name: "Terminé" }));

      expect(await within(summary()).findByText("J'ai compris : + CDD, − Lyon, + Paris (75)")).toBeTruthy();
      expect(asked()).toEqual([
        {
          url: "/api/onboarding/summary-changes",
          method: "POST",
          body: {
            criteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
            summaryText: "Vous recherchez un poste de Directrice financière ; lieu : Lyon.",
            rewritten: "Je cherche un poste de Directrice financière en CDD, à Paris plutôt qu'à Lyon.",
          },
        },
      ]);
      // Nothing changed before it is validated.
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière ; lieu : Lyon.");

      await user.click(within(summary()).getByRole("button", { name: "Valider ces changements" }));
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière en CDD ; lieu : Paris (75).");
      expect(within(summary()).getByText("C'est noté : voici votre résumé mis à jour. Ai-je bien compris ?")).toBeTruthy();

      await user.click(within(summary()).getByRole("button", { name: "Cela semble correct" }));
      expect(await within(thread()).findByRole("link", { name: "Continuer vers mon profil" })).toBeTruthy();
      const patch = calls.find((call) => call.method === "PATCH" && call.url === "/api/profiles/p1");
      expect(patch?.body).toMatchObject({ searchCriteria: { locations: ["Paris (75)"], contractTypes: ["cdd"] } });
    });

    it("« Annuler » on the changes understood leaves the summary as it was", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await toSummary(user);
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
      await user.type(textBox(), " En CDD, à Paris.");
      await user.click(within(summary()).getByRole("button", { name: "Terminé" }));
      await within(summary()).findByText(/J'ai compris/);
      await user.click(within(summary()).getByRole("button", { name: "Annuler" }));
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière ; lieu : Lyon.");
      expect(within(summary()).queryByText(/J'ai compris/)).toBeNull();
    });

    it("says so, and keeps the summary, when the AI's answer is unusable; sends to « Voir le détail » what is not a Search Criterion", async () => {
      const user = userEvent.setup();
      understood = { status: 422, body: { error: "unusable", provenance: null } };
      renderInFrench(<NewProfilePage />);
      await toSummary(user);
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
      await user.type(textBox(), " En CDD.");
      await user.click(within(summary()).getByRole("button", { name: "Terminé" }));
      expect(await within(summary()).findByText(/Je n'ai pas réussi à traduire votre texte en changements de critères : votre résumé reste tel quel/)).toBeTruthy();
      expect(summary().querySelector(".onb-summary")!.textContent).toBe("Vous recherchez un poste de Directrice financière ; lieu : Lyon.");

      understood = {
        status: 200,
        body: { searchCriteria: { targetRole: "Directrice financière", locations: ["Lyon"], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] }, changed: [], other: true, provenance },
      };
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
      await user.type(textBox(), " Je maîtrise SAP.");
      await user.click(within(summary()).getByRole("button", { name: "Terminé" }));
      expect(await within(summary()).findByText(/ne se change pas ici : utilisez « Voir le détail »/)).toBeTruthy();
    });

    it("asks no AI for the summary sent back as it was", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await toSummary(user);
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
      await user.click(within(summary()).getByRole("button", { name: "Terminé" }));
      expect(within(summary()).getByText(/Je ne vois aucun changement de vos critères de recherche/)).toBeTruthy();
      expect(asked()).toEqual([]);
    });

    it("shows the step in « Création du profil », with its model and tokens", async () => {
      const user = userEvent.setup();
      renderInFrench(<NewProfilePage />);
      await toSummary(user);
      await user.click(within(summary()).getByRole("button", { name: "Modifier" }));
      await user.type(textBox(), " En CDD, à Paris.");
      await user.click(within(summary()).getByRole("button", { name: "Terminé" }));
      await within(summary()).findByText(/J'ai compris/);

      const activity = screen.getByRole("complementary", { name: "Activité" });
      const row = within(activity).getByRole("button", { name: /Création du profil/ });
      await user.click(row);
      const detail = document.getElementById(row.getAttribute("aria-controls")!)!;
      expect(detail.textContent).toMatch(/Modification du résumé/);
      expect(detail.textContent).toMatch(/Mistral Medium 3\.5/);
      expect(detail.textContent).toMatch(/Modification du résumé340 jetons/);
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

      await user.click(within(screen.getByRole("group", { name: "Suggestions" })).getByRole("button", { name: "Importer un autre CV" }));
      await waitFor(() => expect(activity().textContent).toContain("Rien encore sur cette page."));
    });
  });
});
