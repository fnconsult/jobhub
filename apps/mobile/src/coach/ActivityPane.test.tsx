import { act, screen, userEvent } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { renderInApp } from "../testing";
import { ActivityPane } from "./ActivityPane";
import { CoachConversation } from "./CoachConversation";
import { PageConversationProvider } from "./page-conversation";
import { aiStep, fakeCoachWeb, type FakeCoachWeb } from "./testing";

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

let web: FakeCoachWeb;
beforeEach(() => (web = fakeCoachWeb()));
afterEach(() => jest.restoreAllMocks());

/** The page's conversation, and its Activité pane beside it, as the shell puts them. */
const renderPage = (conversationId: string | null = null) =>
  renderInApp(
    <PageConversationProvider>
      <CoachConversation conversationId={conversationId} route="/" />
      <ActivityPane />
    </PageConversationProvider>,
    web.client,
  );

async function ask(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Votre message"), text);
  await user.press(screen.getByRole("button", { name: "Envoyer" }));
  return user;
}

describe("Activité, beside a Coach Conversation (ADR-0070)", () => {
  it("shows the Context bar empty before the first message", async () => {
    await renderPage();
    expect(screen.getByText("Contexte de la conversation")).toBeOnTheScreen();
    expect(screen.getByText("0 / 40 messages · 0 / 12k jetons")).toBeOnTheScreen();
  });

  it("fills the Context bar with what the server said of the latest reply", async () => {
    await renderPage();
    await ask("Bonjour");
    await act(async () => web.reply("Bonjour !"));
    expect(await screen.findByText("2 / 40 messages · 1,5k / 12k jetons")).toBeOnTheScreen();
    expect(screen.getByRole("progressbar", { name: "Contexte de la conversation" })).toHaveAccessibilityValue({ min: 0, max: 100, now: 13 });
  });

  it("says from 80 % that the coach reads only the latest messages, and offers « Effacer la conversation » after the Dialog", async () => {
    web = fakeCoachWeb({
      conversations: [
        { id: "c5", title: "Longue", messages: Array.from({ length: 34 }, (_, at) => ({ from: at % 2 ? ("coach" as const) : ("candidate" as const), text: `Message ${at}` })) },
      ],
    });
    await renderPage("c5");
    expect(await screen.findByText("Le coach ne lit que les messages les plus récents.")).toBeOnTheScreen();
    jest.spyOn(Alert, "alert").mockImplementation((_title, _text, buttons?: AlertButton[]) => buttons?.find((each) => each.text === "Effacer")?.onPress?.());
    await userEvent.setup().press(screen.getByRole("button", { name: "Effacer la conversation" }));
    expect(await screen.findByText("0 / 40 messages · 0 / 12k jetons")).toBeOnTheScreen();
    expect(web.saved.has("c5")).toBe(false);
  });

  it("shows the reply on its way in AI Activity, its step and « Arrêter la réponse du coach »", async () => {
    await renderPage();
    await ask("Bonjour");
    await act(async () => web.pending().send(aiStep(1).started));
    expect(await screen.findByText("Réponse du coach · Réflexion")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "Arrêter la réponse du coach" }));
    expect(await screen.findByText(/Réponse arrêtée/)).toBeOnTheScreen();
  });

  it("lists the replies given on the page, with their models and tokens", async () => {
    await renderPage();
    expect(screen.getByText("Aucun contenu produit par l'IA sur cette page")).toBeOnTheScreen();
    await ask("Bonjour");
    await act(async () => web.reply("Bonjour !", { provenance: PROVENANCE }));
    expect(await screen.findByText(/^Réponse du coach · \d{1,2}:\d{2}$/)).toBeOnTheScreen();
    expect(screen.getByText("mistral-large-latest · 1,5k tokens")).toBeOnTheScreen();
  });
});
