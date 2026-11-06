import type { JobSearchResponse, ProfileResponse } from "@jobhub/shared/reads";
import { act, screen, userEvent } from "@testing-library/react-native";
import { Slot } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Text } from "react-native";
import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { AppProviders } from "../app-providers";
import { fakeNetwork, memoryStorage } from "../offline/testing";
import { PushProvider } from "../push/PushNotifications";
import type { PushDevice } from "../push/push-device";
import { METRICS } from "../testing";
import { found } from "./testing";
import { JobSearchPage } from "./JobSearchPage";

const SEARCH: JobSearchResponse = {
  id: "s1",
  profile: { id: "p1", name: "DAF" },
  status: "done",
  failure: null,
  startedAt: "2026-11-02T08:00:00.000Z",
  jobOffers: [found("a"), found("b", { matchScore: 64, decision: "kept", applicationId: "app-b" })],
};

const PROFILE: ProfileResponse = {
  id: "p1",
  name: "DAF",
  archived: false,
  searchCriteria: { targetRole: "Directeur financier", locations: ["Lyon", "Bordeaux"], contractTypes: ["cdi"], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
  masterCv: { version: 1, content: { fullName: "Marie Dupont", headline: "DAF", email: "", phone: "", location: "Lyon", summary: "", experience: [], education: [], skills: [], languages: [] } },
  atsScore: null,
};

/** The Upgrade Prompt of a spent Plan Quota, as `quotaExceededResponse` (apps/web/src/billing/upgrade-prompt.ts) words it. */
const QUOTA_PROMPT = {
  title: "Limite atteinte",
  message: "Vous avez utilisé votre recherche d'offres de la semaine avec l'offre Gratuit. Passez à Standard pour en lancer davantage.",
  upgradeTo: "standard",
  action: "Passer à Standard",
  href: "/abonnement",
};

/** The web app's reads of a Job Search and its Profile, and `POST /api/job-searches` answering `started`. */
function serve(started: { status: number; body: unknown }) {
  const starts: unknown[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/job-searches/s1") return Response.json(SEARCH);
    if (url.pathname === "/api/profiles/p1") return Response.json(PROFILE);
    if (url.pathname === "/api/job-searches" && init?.method === "POST") {
      starts.push(JSON.parse(String(init.body)));
      return Response.json(started.body, { status: started.status });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return { starts };
}

/** A device never asked for Push notifications: the explanation shows when the app asks. */
const neverAsked = (): PushDevice => ({ permission: async () => "notAsked", allow: jest.fn(async () => "allowed"), decline: async () => {}, sync: async () => {}, forget: async () => {} });

async function open() {
  await renderRouter(
    {
      _layout: () => (
        <AppProviders i18n={createI18n(DEFAULT_LOCALE)} initialMetrics={METRICS} device={{ storage: memoryStorage(), network: fakeNetwork(true) }}>
          <PushProvider device={neverAsked()} system={{ onTapped: () => () => {}, onTokenRotated: () => () => {}, openSettings: () => {} }} navigate={() => {}}>
            <Slot />
          </PushProvider>
        </AppProviders>
      ),
      "recherches/[id]": () => <JobSearchPage id="s1" />,
      "recherches/s2": () => <Text>Nouvelle recherche</Text>,
    },
    { initialUrl: "/recherches/s1" },
  );
  await screen.findByText("Offres trouvées pour « DAF »");
}

describe("a Job Search's page in the app (#692)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("shows where it stands, its Search Criteria to read, and its Job Offers, best Match Score first", async () => {
    serve({ status: 201, body: { id: "s2" } });
    await open();

    expect(screen.getByText("Terminée")).toBeOnTheScreen();
    expect(await screen.findByText("Lieux : Lyon, Bordeaux")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Modifier les critères" })).toBeOnTheScreen();
    expect(screen.getAllByRole("link").map((link) => link.props.accessibilityLabel ?? link.props["aria-label"])).toEqual(
      expect.arrayContaining(["Offre a · Acme Industrie", "Offre b · Acme Industrie"]),
    );
    expect(screen.getByText("Match Score 64 · Lyon · Suivie")).toBeOnTheScreen();
  });

  it("« Relancer une recherche » starts one for its Profile, opens it, then asks for Push notifications (#699)", async () => {
    const { starts } = serve({ status: 201, body: { id: "s2" } });
    await open();

    await userEvent.setup().press(screen.getByRole("button", { name: "Relancer une recherche" }));

    expect(starts).toEqual([{ profileId: "p1" }]);
    expect(await screen.findByText("Nouvelle recherche")).toBeOnTheScreen();
    expect(screen.getByText("Être prévenu des nouveaux résultats ?")).toBeOnTheScreen();
  });

  it("a relaunch refused for lack of Plan Quota says so as the web does, with nothing to buy, and asks nothing", async () => {
    serve({ status: 402, body: { error: "quota_exceeded", quota: "jobSearches", plan: "free", limit: 1, upgradeTo: "standard", prompt: QUOTA_PROMPT } });
    await open();

    await userEvent.setup().press(screen.getByRole("button", { name: "Relancer une recherche" }));

    expect(await screen.findByText("Limite atteinte")).toBeOnTheScreen();
    expect(screen.getByText(QUOTA_PROMPT.message)).toBeOnTheScreen();
    expect(screen.queryByText("Passer à Standard")).toBeNull();
    expect(screen.queryByText("Être prévenu des nouveaux résultats ?")).toBeNull();
    await act(async () => {});
    expect(screen.getByText("Offres trouvées pour « DAF »")).toBeOnTheScreen();
  });
});
