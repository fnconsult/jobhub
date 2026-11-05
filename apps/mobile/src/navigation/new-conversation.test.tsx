import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { userEvent } from "@testing-library/react-native";
import { act, renderRouter, screen } from "expo-router/testing-library";
import { Slot } from "expo-router";
import { AccessibilityInfo } from "react-native";
import { AppProviders } from "../app-providers";
import { ActivityPane } from "../coach/ActivityPane";
import { PageConversationProvider } from "../coach/page-conversation";
import { fakeCoachWeb, type FakeCoachWeb } from "../coach/testing";
import { fakeNetwork, memoryStorage } from "../offline/testing";
import { NEW_CONVERSATION, paths } from "./pages";
import Home from "../app/index";
import FreeConversation from "../app/conversations/[id]";

const PROVENANCE = {
  v: 1,
  steps: [
    {
      kind: "ai",
      activity: "think_write",
      task: "coach_reply",
      provider: "mistral",
      model: "mistral-large-latest",
      tokens: { input: 1100, output: 400 },
      ms: 2300,
      at: "2026-11-05T10:00:00.000Z",
      outcome: "ok",
      count: 1,
    },
  ],
  sites: [],
  startedAt: "2026-11-05T10:00:00.000Z",
  wallMs: 2400,
};

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

let web: FakeCoachWeb;
beforeEach(() => {
  web = fakeCoachWeb();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** The app's two pages of a new Free conversation, the home page and « Nouvelle conversation », with Activité beside them. */
async function renderApp(initialUrl: string) {
  const i18n = createI18n(DEFAULT_LOCALE);
  const Layout = () => (
    <AppProviders i18n={i18n} initialMetrics={METRICS} device={{ storage: memoryStorage(), network: fakeNetwork(true) }} api={web.api}>
      <PageConversationProvider>
        <Slot />
        <ActivityPane />
      </PageConversationProvider>
    </AppProviders>
  );
  const app = await renderRouter({ _layout: Layout, index: Home, "conversations/[id]": FreeConversation }, { initialUrl });
  // renderRouter fakes the timers; the reply's stream is read as the app reads it, on real ones.
  jest.useRealTimers();
  return app;
}

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Votre message"), text);
  await user.press(screen.getByRole("button", { name: "Envoyer" }));
  return user;
}

describe.each([
  ["the home page", paths.home],
  ["« Nouvelle conversation »", paths.conversation(NEW_CONVERSATION)],
])("the first message of a new Free conversation, from %s", (_page, initialUrl) => {
  it("gives the page the conversation's address, and the page stays as it was", async () => {
    const app = await renderApp(initialUrl);
    await ask("Bonjour");
    await act(async () => web.reply("Bonjour !", { provenance: PROVENANCE }));

    expect(await screen.findByText("Bonjour !")).toBeOnTheScreen();
    expect(app.getPathname()).toBe(paths.conversation("c1"));
    // Activité's AI Activity keeps the reply given on this page: the server never stores it.
    expect(screen.getByText("mistral-large-latest · 1,5k tokens")).toBeOnTheScreen();
    expect(screen.queryByText("Chargement…")).toBeNull();
  });

  it("keeps « Réponse arrêtée » after « Arrêter », though the server keeps only the question", async () => {
    const app = await renderApp(initialUrl);
    const user = await ask("Une longue question");
    await act(async () => void web.named());
    await user.press(screen.getByRole("button", { name: "Arrêter" }));

    expect(await screen.findByText(/Réponse arrêtée/)).toBeOnTheScreen();
    expect(app.getPathname()).toBe(paths.conversation("c1"));
    expect(screen.getByText("Une longue question")).toBeOnTheScreen();
  });

  it("offers the team at once under a first reply the coach could not answer", async () => {
    const app = await renderApp(initialUrl);
    await ask("Quel est le nom de mon conseiller ?");
    await act(async () => web.reply("Je ne sais pas.", { couldNotAnswer: true }));

    expect(await screen.findByText("Votre coach IA n'a pas cette réponse : l'équipe Jobbbox peut vous répondre.")).toBeOnTheScreen();
    expect(app.getPathname()).toBe(paths.conversation("c1"));
  });

  it("goes on in the conversation it saved", async () => {
    await renderApp(initialUrl);
    const user = await ask("Bonjour");
    await act(async () => web.reply("Bonjour !"));
    await screen.findByText("Bonjour !");
    await user.type(screen.getByLabelText("Votre message"), "Et ensuite ?");
    await user.press(screen.getByRole("button", { name: "Envoyer" }));
    expect(web.asked.at(-1)).toMatchObject({ conversationId: "c1", message: "Et ensuite ?" });
  });
});
