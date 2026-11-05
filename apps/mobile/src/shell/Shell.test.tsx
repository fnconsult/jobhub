import { act, screen, userEvent } from "@testing-library/react-native";
import { Platform, Pressable, Text } from "react-native";
import { fakeNetwork } from "../offline/testing";
import { hardwareKeyboard, renderInApp, setWindow } from "../testing";
import { CoachConversation } from "../coach/CoachConversation";
import { fakeCoachWeb } from "../coach/testing";
import { Shell, useWorkPane, type ShellPage } from "./Shell";

const PHONE = { width: 390, height: 844 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };
const SPLIT_VIEW = { width: 507, height: 1024 };

const application: ShellPage = { key: "/candidatures/a1", title: "Aéroline", pane: "fiche" };
const home: ShellPage = { key: "/", title: "Jobbbox", pane: "activite" };

function SectionLink() {
  const workPane = useWorkPane();
  return (
    <Pressable role="button" onPress={() => workPane.open({ title: "Offre", content: <Text>Contenu de la Section</Text> })}>
      <Text>Ouvrir la Section</Text>
    </Pressable>
  );
}

async function renderShell(page: ShellPage = application, onNewConversation = () => {}) {
  await renderInApp(
    <Shell page={page} paneContent={<><Text>Contenu de la Fiche</Text><SectionLink /></>} sidebar={() => <Text>Mes candidatures</Text>} onNewConversation={onNewConversation}>
      <Text>La conversation</Text>
    </Shell>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });
const noButton = (name: string) => expect(screen.queryByRole("button", { name })).toBeNull();

describe("Shell, below 64rem", () => {
  beforeEach(() => setWindow(PHONE));

  it("opens the Fiche full page over the page and its Top Bar, and « Fermer » closes it", async () => {
    await renderShell();
    const user = userEvent.setup();
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();

    await user.press(button("Fiche"));
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
    noButton("Menu");
    expect(screen.queryByText("La conversation")).toBeNull();

    await user.press(button("Fermer"));
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
    expect(button("Menu")).toBeOnTheScreen();
  });

  it("opens the Work Pane over the Fiche, and closing it returns to the Fiche", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.press(button("Fiche"));
    await user.press(button("Ouvrir la Section"));
    expect(screen.getByText("Contenu de la Section")).toBeOnTheScreen();
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();

    await user.press(button("Fermer"));
    expect(screen.queryByText("Contenu de la Section")).toBeNull();
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
  });

  it("offers « Activité » on a page without an object", async () => {
    await renderShell(home);
    await userEvent.setup().press(button("Activité"));
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
  });

  it("opens the Sidebar in a drawer, which « Fermer le menu » closes", async () => {
    await renderShell();
    const user = userEvent.setup();
    expect(screen.queryByText("Mes candidatures")).toBeNull();

    await user.press(button("Menu"));
    expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();

    await user.press(button("Fermer le menu"));
    expect(screen.queryByText("Mes candidatures")).toBeNull();
  });

  it("puts the pencil « Nouvelle conversation » in the Top Bar", async () => {
    await renderShell();
    expect(button("Nouvelle conversation")).toBeOnTheScreen();
  });
});

describe("Shell, from 64rem", () => {
  beforeEach(() => setWindow(IPAD_LANDSCAPE));

  it("shows the Sidebar as a column; « Masquer le menu » hides it and « Menu » brings it back", async () => {
    await renderShell();
    const user = userEvent.setup();
    expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();

    await user.press(button("Masquer le menu"));
    expect(screen.queryByText("Mes candidatures")).toBeNull();

    await user.press(button("Menu"));
    expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();
  });

  it("opens an object's Fiche beside the conversation, which stays in reach; « Fiche » closes it", async () => {
    await renderShell();
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
    expect(screen.getByText("La conversation")).toBeOnTheScreen();
    noButton("Fermer");

    await userEvent.setup().press(button("Fiche"));
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
  });

  it("gives the Fiche's place to the Work Pane without room for both; « Fiche » brings the Fiche back", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.press(button("Ouvrir la Section"));
    expect(screen.getByText("Contenu de la Section")).toBeOnTheScreen();
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
    expect(screen.getByText("La conversation")).toBeOnTheScreen();

    await user.press(button("Fiche"));
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
    expect(screen.queryByText("Contenu de la Section")).toBeNull();
  });

  it("closes the Work Pane column with its « Fermer »", async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.press(button("Ouvrir la Section"));
    await user.press(button("Fermer"));
    expect(screen.queryByText("Contenu de la Section")).toBeNull();
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
  });

  it("lays itself out again when the window changes, as in Split View", async () => {
    await renderShell();
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();

    await act(() => setWindow(SPLIT_VIEW));
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
    expect(button("Menu")).toBeOnTheScreen();

    await act(() => setWindow(IPAD_LANDSCAPE));
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
  });

  it("falls back to full pages when the system text is larger", async () => {
    setWindow({ ...IPAD_LANDSCAPE, fontScale: 1.5 });
    await renderShell();
    expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
    await userEvent.setup().press(button("Fiche"));
    expect(button("Fermer")).toBeOnTheScreen();
    noButton("Menu");
  });
});

describe("Shell, when multitasking or a foldable changes the window", () => {
  // An iPad Pro 12.9" in landscape and its Split View thirds (disposition.test.ts); a Pixel Fold folded, then open.
  const IPAD_THIRD = { width: 375, height: 1024 };
  const IPAD_HALF = { width: 678, height: 1024 };
  const IPAD_TWO_THIRDS = { width: 981, height: 1024 };
  const FOLDED = { width: 412, height: 915 };
  const UNFOLDED = { width: 841, height: 701 };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function renderWithConversation() {
    const web = fakeCoachWeb();
    await renderInApp(
      <Shell page={application} paneContent={<Text>Contenu de la Fiche</Text>} sidebar={() => <Text>Mes candidatures</Text>} onNewConversation={() => {}}>
        <CoachConversation conversationId={null} route="/" />
      </Shell>,
      { api: web.api },
    );
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.type(screen.getByLabelText("Votre message"), "Ma question");
    await user.press(button("Envoyer"));
    await act(async () => web.reply("Une réponse"));
    await act(() => jest.runAllTimers());
    await user.type(screen.getByLabelText("Votre message"), "Un brouillon");
  }

  const expectConversationKept = () => {
    expect(screen.getByText("Ma question")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toHaveDisplayValue("Un brouillon");
  };

  it("keeps the conversation and the draft from the whole screen to a third, a half, two thirds and back", async () => {
    setWindow(IPAD_LANDSCAPE);
    await renderWithConversation();
    for (const window of [IPAD_THIRD, IPAD_HALF, IPAD_TWO_THIRDS, IPAD_LANDSCAPE]) {
      await act(() => setWindow(window));
      expectConversationKept();
    }
  });

  it("keeps them when a foldable opens and closes", async () => {
    setWindow(FOLDED);
    await renderWithConversation();
    await act(() => setWindow(UNFOLDED));
    expectConversationKept();
    await act(() => setWindow(FOLDED));
    expectConversationKept();
  });
});

describe("Shell, with a hardware keyboard", () => {
  const { panel, press } = hardwareKeyboard;

  describe("on an iPad in landscape", () => {
    beforeEach(() => setWindow(IPAD_LANDSCAPE));

    it("lists its shortcuts in the ⌘ panel, in French", async () => {
      await renderShell();
      expect(panel()).toEqual(["⌘N Nouvelle conversation", "⌘\\ Afficher ou masquer le menu", "⌘I Afficher ou masquer la Fiche"]);
    });

    it("offers ⌘W and Échap while the Work Pane is open, and no more once it is closed", async () => {
      await renderShell();
      await userEvent.setup().press(button("Ouvrir la Section"));
      expect(panel()).toEqual(expect.arrayContaining(["⌘W Fermer le Work Pane", "Échap Fermer le volet"]));

      await press("⌘W");
      expect(screen.queryByText("Contenu de la Section")).toBeNull();
      expect(panel()).not.toContain("⌘W Fermer le Work Pane");
      expect(panel()).not.toContain("Échap Fermer le volet");
    });

    it("starts a new conversation with ⌘N", async () => {
      const onNewConversation = jest.fn();
      await renderShell(application, onNewConversation);
      await press("⌘N");
      expect(onNewConversation).toHaveBeenCalledTimes(1);
    });

    it("hides the Sidebar with ⌘\\, and brings it back", async () => {
      await renderShell();
      await press("⌘\\");
      expect(screen.queryByText("Mes candidatures")).toBeNull();
      await press("⌘\\");
      expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();
    });

    it("closes and opens the Fiche with ⌘I", async () => {
      await renderShell();
      await press("⌘I");
      expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
      await press("⌘I");
      expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
    });

    it("opens Activité with ⌘I on a page without an object", async () => {
      await renderShell(home);
      expect(panel()).toContain("⌘I Afficher ou masquer Activité");
      await press("⌘I");
      expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
    });

    it("closes the Work Pane with Échap, and leaves the Fiche to ⌘I and « Fiche »", async () => {
      await renderShell();
      await userEvent.setup().press(button("Ouvrir la Section"));
      await press("Échap");
      expect(screen.queryByText("Contenu de la Section")).toBeNull();
      expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
      await press("Échap");
      expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
    });
  });

  describe("below 64rem", () => {
    beforeEach(() => setWindow(SPLIT_VIEW));

    it("opens the Sidebar's drawer with ⌘\\, and Échap closes it", async () => {
      await renderShell();
      await press("⌘\\");
      expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();
      await press("Échap");
      expect(screen.queryByText("Mes candidatures")).toBeNull();
    });

    it("closes the full page on top with Échap: the Work Pane, then the Fiche beneath it", async () => {
      await renderShell();
      const user = userEvent.setup();
      await user.press(button("Fiche"));
      await user.press(button("Ouvrir la Section"));
      await press("Échap");
      expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
      await press("Échap");
      expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
      expect(button("Menu")).toBeOnTheScreen();
    });
  });

  describe("on an Android tablet", () => {
    beforeEach(() => {
      setWindow(IPAD_LANDSCAPE);
      jest.replaceProperty(Platform, "OS", "android");
    });
    afterEach(() => jest.restoreAllMocks());

    it("takes Ctrl in place of ⌘, listed so in the Keyboard Shortcuts Helper", async () => {
      await renderShell();
      expect(panel()).toEqual(["Ctrl+N Nouvelle conversation", "Ctrl+\\ Afficher ou masquer le menu", "Ctrl+I Afficher ou masquer la Fiche"]);
      await press("Ctrl+I");
      expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
      await press("⌘I");
      expect(screen.queryByText("Contenu de la Fiche")).toBeNull();
    });
    });
  });

describe("Shell, without network", () => {
  beforeEach(() => setWindow(PHONE));

  it("says « Hors ligne » above the page, and stops saying it once the network is back", async () => {
    const network = fakeNetwork(false);
    await renderInApp(
      <Shell page={home} paneContent={null} sidebar={() => null} onNewConversation={() => {}}>
        <Text>La conversation</Text>
      </Shell>,
      { network },
    );
    expect(screen.getByText("Hors ligne")).toBeOnTheScreen();
    expect(screen.getByText(/ce qui a été chargé en dernier/)).toBeOnTheScreen();
    expect(screen.getByText("La conversation")).toBeOnTheScreen();

    await act(() => network.set(true));
    expect(screen.queryByText("Hors ligne")).toBeNull();
  });

  it("says nothing with network", async () => {
    await renderShell(home);
    expect(screen.queryByText("Hors ligne")).toBeNull();
  });
});
