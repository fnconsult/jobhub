import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import Constants from "expo-constants";
import { AccessibilityInfo, Platform } from "react-native";
import { fakeNetwork } from "../offline/testing";
import { Shell } from "../shell/Shell";
import { hardwareKeyboard, renderInApp, setWindow } from "../testing";
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
/** What a test changed beyond Jest's mocks, put back after it. */
const putBack: (() => void)[] = [];
const afterThis = (restore: () => void) => void putBack.push(restore);
afterEach(() => {
  jest.restoreAllMocks();
  putBack.splice(0).forEach((restore) => restore());
});

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

/** The conversation in the app's shell, on a phone, its Work Pane full page over it. */
async function renderInShell(placement: { conversationId: string | null; route: string } = { conversationId: null, route: "/" }) {
  setWindow({ width: 390, height: 844 });
  await renderInApp(
    <Shell page={{ key: placement.route, title: "Accueil", pane: "activite" }} paneContent={null} sidebar={() => null} onNewConversation={() => {}}>
      <CoachConversation {...placement} />
    </Shell>,
    { api: web.api },
  );
}

const PROPOSAL = {
  id: "k1",
  status: "pending",
  change: {
    target: { kind: "application", id: "a1", name: "Responsable qualité · Aéroline", href: "/candidatures/a1" },
    what: "Statut de la candidature",
    before: "Postulée",
    after: "Entretien",
    value: { status: "interview" },
    fields: [],
  },
  undoable: false,
};

describe("the help in the conversation's box (ADR-0035)", () => {
  it("suggests Help Articles while the Candidate types, from the help bundled with the app", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await userEvent.setup().type(box(), "quota");
    expect(await screen.findByText("Dans l'aide, sans IA")).toBeOnTheScreen();
    expect(button(/^Quand mon quota se renouvelle-t-il \?, Question fréquente$/)).toBeOnTheScreen();
    expect(web.requests.filter((request) => request.method !== "GET")).toEqual([]);
  });

  it("opens an article in the Work Pane, full page on a phone; « Non, demander au coach » asks about it, its title sent along", async () => {
    await renderInShell();
    const user = userEvent.setup();
    await user.type(box(), "quota");
    await user.press(await screen.findByRole("button", { name: /^Quand mon quota se renouvelle-t-il \?/ }));
    expect(screen.getByText(/Chaque lundi à 0 h/)).toBeOnTheScreen();
    expect(screen.getByText("Cela répond à votre question ?")).toBeOnTheScreen();

    await user.press(button("Non, demander au coach"));
    expect(screen.queryByText(/Chaque lundi à 0 h/)).toBeNull();
    expect(box()).toHaveDisplayValue("À propos de « Quand mon quota se renouvelle-t-il ? » : ");
    await user.type(box(), "et le dimanche ?");
    await user.press(button("Envoyer"));
    expect(web.asked.at(-1)).toMatchObject({ helpArticle: { id: "faq-quota-renewal", title: "Quand mon quota se renouvelle-t-il ?" } });
  });

  it("offers « Comment marche cette page ? » and « Souvent demandé » in an empty conversation", async () => {
    await renderInShell();
    expect(screen.getByText("Souvent demandé")).toBeOnTheScreen();
    expect(button("Quand mon quota se renouvelle-t-il ?")).toBeOnTheScreen();
    await userEvent.setup().press(button("Comment marche cette page ?"));
    expect(screen.getByText("Aide · écrit par l'équipe Jobbbox")).toBeOnTheScreen();
  });

  it("asks « Cela répond à votre question ? » under each reply: « Oui » thanks, « Non » offers the team", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    const user = await write("Comment relancer ?");
    await act(async () => web.reply("Envoyez un court message."));
    await screen.findByText("Envoyez un court message.");
    await user.press(button("Non"));
    expect(screen.getByText("L'équipe Jobbbox peut vous répondre.")).toBeOnTheScreen();
    expect(button("Poser la question à l'équipe")).toBeOnTheScreen();

    await user.type(box(), "Merci");
    await user.press(button("Envoyer"));
    await act(async () => web.reply("Avec plaisir."));
    await screen.findByText("Avec plaisir.");
    await user.press(button("Oui"));
    expect(screen.getByText("Merci de votre retour.")).toBeOnTheScreen();
  });

  it("offers the team at once under a reply the coach could not answer", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("Quel est le nom de mon conseiller ?");
    await act(async () => web.reply("Je ne sais pas.", { couldNotAnswer: true }));
    expect(await screen.findByText("Votre coach IA n'a pas cette réponse : l'équipe Jobbbox peut vous répondre.")).toBeOnTheScreen();
  });

  it("shows what the help has when the coach cannot reply", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("Quand mon quota se renouvelle ?");
    await act(async () => web.fail("provider_unavailable"));
    expect(await screen.findByText("Voici ce que l'aide propose :")).toBeOnTheScreen();
    expect(button("Poser la question à l'équipe")).toBeOnTheScreen();
  });
});

describe("the Signalement form, native, under the box", () => {
  it("sends a Question to the team with the exchange, from « Poser la question à l'équipe »", async () => {
    await renderInShell();
    const user = await write("Comment relancer ?");
    await act(async () => web.reply("Envoyez un court message."));
    await screen.findByText("Envoyez un court message.");
    await user.press(button("Non"));
    await user.press(button("Poser la question à l'équipe"));

    expect(screen.getByLabelText("Votre question")).toHaveDisplayValue("Comment relancer ?");
    expect(screen.getByText(/Échange : votre question et la réponse du coach/)).toBeOnTheScreen();
    await user.press(button("Envoyer"));
    expect(await screen.findByText("Merci, c'est envoyé.")).toBeOnTheScreen();
    expect(web.signalements).toEqual([
      { type: "question", message: "Comment relancer ?", path: "/", textSize: "standard", attachedQuestion: "Comment relancer ?", attachedCoachReply: "Envoyez un court message." },
    ]);
  });

  it("reports a problem from under the box, with its context said before sending, and refuses one too short", async () => {
    await renderInShell();
    const user = userEvent.setup();
    await user.press(button("Signaler un problème"));
    expect(screen.getByText(/Joints automatiquement : la page, la version de Jobbbox, votre appareil/)).toBeOnTheScreen();
    await user.press(button("Voir le détail"));
    expect(screen.getByText("Appareil")).toBeOnTheScreen();

    await user.type(screen.getByLabelText("Décrivez le problème"), "Bug");
    await user.press(button("Envoyer"));
    expect(screen.getByText("Au moins 10 caractères, pour que l'équipe comprenne.")).toBeOnTheScreen();
    expect(web.signalements).toEqual([]);

    await user.type(screen.getByLabelText("Décrivez le problème"), " : le bouton ne répond pas");
    await user.press(button("Envoyer"));
    expect(await screen.findByText("Merci, c'est envoyé.")).toBeOnTheScreen();
    expect(web.signalements).toEqual([{ type: "bug", message: "Bug : le bouton ne répond pas", path: "/", textSize: "standard" }]);
  });

  it("sends the app's version and device it says it attaches (#690): a native fetch's user agent names neither", async () => {
    // The installed app's version (app.json, else package.json, at build time) and the system's, as a device has them.
    const config = Constants.expoConfig!;
    const version = config.version;
    config.version = "1.4.0";
    afterThis(() => void (config.version = version));
    jest.spyOn(Platform, "Version", "get").mockReturnValue("18.6");
    await renderInShell();
    const user = userEvent.setup();
    await user.press(button("Signaler un problème"));
    await user.press(button("Voir le détail"));
    expect(screen.getByText("1.4.0")).toBeOnTheScreen();
    expect(screen.getByText("iOS 18.6")).toBeOnTheScreen();

    await user.type(screen.getByLabelText("Décrivez le problème"), "Le bouton ne répond pas");
    await user.press(button("Envoyer"));
    await screen.findByText("Merci, c'est envoyé.");
    expect(web.signalementDevices).toEqual(["1.4.0 (iOS 18.6)"]);
  });

  it("proposes an idea", async () => {
    await renderInShell();
    const user = userEvent.setup();
    await user.press(button("Proposer une idée"));
    await user.type(screen.getByLabelText("Décrivez votre idée"), "Un mode sombre pour les PDF");
    await user.press(button("Envoyer"));
    await screen.findByText("Merci, c'est envoyé.");
    expect(web.signalements).toEqual([expect.objectContaining({ type: "idee" })]);
  });
});

describe("a Coach proposal under a reply", () => {
  it("is applied by the Candidate", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("J'ai un entretien");
    await act(async () => web.reply("Je vous propose de changer le statut.", { cards: [PROPOSAL] }));
    expect(await screen.findByText("Statut de la candidature · Responsable qualité · Aéroline")).toBeOnTheScreen();
    await userEvent.setup().press(button("Appliquer"));
    expect(await screen.findByText(/^Appliqué par vous à \d{2}:\d{2}$/)).toBeOnTheScreen();
  });

  it("refused by a Plan Quota, says so as the web does, with nothing to buy in the app", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { api: web.api });
    await write("Calcule le Match Score");
    const prompt = {
      title: "Vous avez atteint la limite de votre offre",
      message: "Vous avez utilisé les 3 Match Scores compris cette semaine dans l'offre Gratuite. Passez à l'offre Pro pour en utiliser davantage.",
      upgradeTo: "pro",
      action: "Passer à l'offre Pro",
      href: "/abonnement",
    };
    await act(async () =>
      web.reply("Je peux le calculer.", { cards: [{ ...PROPOSAL, id: "k2", change: { ...PROPOSAL.change, quota: { label: "Utilise 1 Match Score", prompt } } }] }),
    );
    expect(await screen.findByText("Vous avez atteint la limite de votre offre")).toBeOnTheScreen();
    expect(screen.getByText(/Vous avez utilisé les 3 Match Scores/)).toBeOnTheScreen();
    expect(screen.getByText("Votre abonnement se gère sur jobbbox.ai.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Passer à l'offre Pro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Appliquer" })).toBeNull();
  });
});
