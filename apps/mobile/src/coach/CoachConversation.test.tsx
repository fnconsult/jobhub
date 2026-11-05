import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { fakeNetwork } from "../offline/testing";
import { hardwareKeyboard, renderInApp } from "../testing";
import { CoachConversation } from "./CoachConversation";
import { aiStep, fakeCoachWeb, replyEvent, type FakeCoachWeb } from "./testing";

let web: FakeCoachWeb;
beforeEach(() => {
  web = fakeCoachWeb();
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation(() => {})
    .mockClear();
});
afterEach(() => jest.restoreAllMocks());

const box = () => screen.getByLabelText("Votre message");
const button = (name: string | RegExp) => screen.getByRole("button", { name });

async function write(text: string) {
  const user = userEvent.setup();
  await user.type(box(), text);
  await user.press(button("Envoyer"));
  return user;
}

describe("a Coach Conversation in the app", () => {
  it("says the coach is an AI before anything is written", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    expect(screen.getByText(/Je suis un coach IA, pas une personne/)).toBeOnTheScreen();
  });

  it("sends the message to the coach and shows the reply as its events come, « Arrêter » meanwhile", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("Aide-moi à préparer un entretien");

    expect(web.asked).toEqual([{ message: "Aide-moi à préparer un entretien", route: "/" }]);
    expect(screen.getByText("Aide-moi à préparer un entretien")).toBeOnTheScreen();
    expect(button("Arrêter")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Envoyer" })).toBeNull();

    await act(async () => web.pending().send(aiStep(1).started));
    expect(await screen.findByText("Réflexion")).toBeOnTheScreen();

    await act(async () => {
      web.pending().send(replyEvent("Parlons de vos réussites."));
      web.pending().end();
    });
    expect(await screen.findByText("Parlons de vos réussites.")).toBeOnTheScreen();
    expect(screen.queryByText("Réflexion")).toBeNull();
    expect(button("Envoyer")).toBeOnTheScreen();
  });

  it("goes on in the conversation the first reply saved", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    const user = await write("Bonjour");
    await act(async () => web.reply("Bonjour !"));
    await screen.findByText("Bonjour !");

    await user.type(box(), "Et ensuite ?");
    await user.press(button("Envoyer"));
    expect(web.asked.at(-1)).toMatchObject({ conversationId: "c1", message: "Et ensuite ?" });
  });

  it("is stopped by « Arrêter »: the question stays, « Réponse arrêtée » stands for the reply", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    const user = await write("Une longue question");
    await act(async () => web.named());

    await user.press(button("Arrêter"));

    expect(await screen.findByText(/Réponse arrêtée/)).toBeOnTheScreen();
    expect(screen.getByText("Une longue question")).toBeOnTheScreen();
    expect(button("Envoyer")).toBeOnTheScreen();
    // The next message goes on in the conversation where the question was kept.
    await user.type(box(), "Plus court");
    await user.press(button("Envoyer"));
    expect(web.asked.at(-1)).toMatchObject({ conversationId: "c1" });
  });

  it("says why there is no reply, as the web does, and gives the message back to send again", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("Bonjour");
    await act(async () => web.fail("provider_unavailable"));

    expect(await screen.findByText(/Votre coach n'a pas pu répondre : .+\. Réessayez dans quelques instants\./)).toBeOnTheScreen();
    expect(box()).toHaveDisplayValue("Bonjour");
    expect(screen.queryByText("Bonjour", { exact: true })).toBeNull();
  });

  it("says a message too long could not be sent", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("Bonjour");
    await act(async () => web.fail(null, "invalid"));
    expect(await screen.findByText("Ce message n'a pas pu être envoyé. Raccourcissez-le et réessayez.")).toBeOnTheScreen();
  });

  it("reopens a saved conversation with its messages", async () => {
    web = fakeCoachWeb({
      conversations: [
        {
          id: "c7",
          title: "Négocier",
          messages: [
            { from: "candidate", text: "Comment négocier ?" },
            { from: "coach", text: "Visez haut.", at: "2026-11-04T10:00:00.000Z" },
          ],
        },
      ],
    });
    await renderInApp(<CoachConversation conversationId="c7" route="/conversations/c7" />, { api: web.api });
    expect(await screen.findByText("Visez haut.")).toBeOnTheScreen();
    expect(screen.getByText("Comment négocier ?")).toBeOnTheScreen();
  });

  describe("with VoiceOver or TalkBack", () => {
    it("announces the reply once it is finished, not word by word", async () => {
      await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
      await write("Bonjour");
      await act(async () => {
        web.pending().send(aiStep(1).started);
        web.pending().send(aiStep(1).ended);
      });
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(expect.stringContaining("Parlons"));

      await act(async () => {
        web.pending().send(replyEvent("Parlons de vos réussites."));
        web.pending().end();
      });
      await screen.findByText("Parlons de vos réussites.");
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(expect.stringContaining("Parlons de vos réussites."));
      expect(jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.filter(([text]) => text.includes("Parlons"))).toHaveLength(1);
    });

    it("never makes the reply a live region read as it changes", async () => {
      await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
      await write("Bonjour");
      await act(async () => web.reply("Parlons de vos réussites."));
      await screen.findByText("Parlons de vos réussites.");
      expect(JSON.stringify(screen.toJSON())).not.toMatch(/"(accessibilityLiveRegion|aria-live)":"(polite|assertive)"/);
    });

    it("announces a failure and a Stop too", async () => {
      await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
      const user = await write("Bonjour");
      await user.press(button("Arrêter"));
      await screen.findByText(/Réponse arrêtée/);
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Réponse arrêtée");
    });
  });

  describe("without network", () => {
    it("disables the box, « Envoyer » and « + », and says why", async () => {
      await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api, network: fakeNetwork(false) });
      expect(box()).toBeDisabled();
      expect(button("Envoyer")).toBeDisabled();
      expect(button("Joindre un lien ou un document")).toBeDisabled();
      expect(screen.getByText(/Hors ligne : vous pourrez écrire au coach dès le retour du réseau/)).toBeOnTheScreen();
    });
  });

  describe("with a hardware keyboard", () => {
    it("sends with ⌘↩, withdrawn while the reply streams", async () => {
      await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
      await userEvent.setup().type(box(), "Bonjour");
      await hardwareKeyboard.press("⌘↩");
      expect(web.asked).toHaveLength(1);
      expect(hardwareKeyboard.panel()).not.toContain("⌘↩ Envoyer le message");
      await act(async () => web.reply("Bonjour !"));
      await waitFor(() => expect(hardwareKeyboard.panel()).toContain("⌘↩ Envoyer le message"));
    });
  });
});
