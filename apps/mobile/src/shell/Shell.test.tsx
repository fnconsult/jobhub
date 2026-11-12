import { act, fireEvent, screen, userEvent, within } from "@testing-library/react-native";
import { Square } from "lucide-react-native";
import { useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text } from "react-native";
import { fakeNetwork } from "../offline/testing";
import { hardwareKeyboard, renderInApp, setWindow } from "../testing";
import { CoachConversation } from "../coach/CoachConversation";
import { fakeCoachWeb } from "../coach/testing";
import { Shell, useWorkPane, type ShellPage } from "./Shell";
import { answerActionSheet, chooseFromMoreActions } from "./testing";
import { TOP_BAR_RANK, useCompactTopBar, useFocusTopBarPrimary, useTopBarPrimary, type TopBarAction } from "./top-bar";

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

  it("puts « Nouvelle conversation » under the Top Bar's « … »", async () => {
    const onNewConversation = jest.fn();
    await renderShell(application, onNewConversation);
    noButton("Nouvelle conversation");
    await chooseFromMoreActions("Nouvelle conversation");
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });
});

describe("Shell, its compact Top Bar below 64rem (#899, ADR-0101)", () => {
  beforeEach(() => setWindow(PHONE));
  afterEach(() => jest.restoreAllMocks());

  const clear = jest.fn();
  const clearAction: TopBarAction = { id: "clear", rank: TOP_BAR_RANK.clear, label: "Effacer la conversation", wideLabel: "Effacer", icon: Square, look: "secondary", run: clear };
  const renderWith = (page: ShellPage, extra: Partial<Parameters<typeof Shell>[0]> = {}, children = <Text>La conversation</Text>) =>
    renderInApp(
      <Shell page={page} paneContent={<Text>Contenu de la Fiche</Text>} sidebar={() => null} onNewConversation={() => {}} actions={[clearAction]} {...extra}>
        {children}
      </Shell>,
    );
  /** The words drawn in the Top Bar, as opposed to its buttons' names. */
  const wordsInTopBar = () => within(screen.getByTestId("top-bar")).queryAllByText(/.+/).map((text) => text.props.children);

  it("shows Menu, the title, « Fiche » on an object's page and « … », icons named for VoiceOver and TalkBack, 44 pt each", async () => {
    await renderWith(application);
    expect(wordsInTopBar()).toEqual(["Aéroline"]);
    for (const name of ["Menu", "Fiche", "Autres actions"]) expect(button(name)).toHaveStyle({ minHeight: 44, minWidth: 44 });
    noButton("Effacer");
    noButton("Activité");
    const offered = answerActionSheet();
    await userEvent.setup().press(button("Autres actions"));
    expect(offered).toEqual([["Effacer la conversation", "Nouvelle conversation", "Annuler"]]);
  });

  it("shows « Activité » on a page without an object, and its entries under « … » do what their buttons do", async () => {
    await renderWith(home);
    await chooseFromMoreActions("Effacer la conversation");
    expect(clear).toHaveBeenCalledTimes(1);
    await userEvent.setup().press(button("Activité"));
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
  });

  it("keeps a screen's own main action in view, « Activité » going under « … »", async () => {
    const filter = jest.fn();
    function Screen() {
      useTopBarPrimary({ label: "Filtrer les offres", icon: Square, run: filter });
      return <Text>La boîte</Text>;
    }
    await renderWith(home, {}, <Screen />);
    noButton("Activité");
    await userEvent.setup().press(button("Filtrer les offres"));
    expect(filter).toHaveBeenCalledTimes(1);
    await chooseFromMoreActions("Activité");
    expect(screen.getByText("Contenu de la Fiche")).toBeOnTheScreen();
  });

  it("names the screen's icon by what it says, draws it pressed while its panel is open and a dot on it when asked (#899, as #898)", async () => {
    function Screen() {
      const [open, setOpen] = useState(false);
      useTopBarPrimary({
        label: "Filtrer les offres à traiter",
        accessibleName: "Filtrer les offres à traiter : 3 à traiter, source Email",
        badge: true,
        icon: Square,
        expanded: open,
        run: () => setOpen(!open),
      });
      return <Text>{useCompactTopBar() ? "Barre compacte" : "Barre large"}</Text>;
    }
    await renderWith(home, {}, <Screen />);
    expect(screen.getByText("Barre compacte")).toBeOnTheScreen();
    const icon = button("Filtrer les offres à traiter : 3 à traiter, source Email");
    expect(within(icon).getByTestId("control-badge", { includeHiddenElements: true })).toBeTruthy();
    expect(icon.props.accessibilityState).toMatchObject({ expanded: false });
    expect(icon).toHaveStyle({ borderWidth: 0 });

    await userEvent.setup().press(icon);
    expect(icon.props.accessibilityState).toMatchObject({ expanded: true });
    expect(icon).toHaveStyle({ borderWidth: 1 });
  });

  it("moves VoiceOver's focus to the screen's icon, or to « … » while an AI action has its place (#899)", async () => {
    const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    function Screen() {
      useTopBarPrimary({ label: "Filtrer les offres", icon: Square, run: () => {} });
      const focusPrimary = useFocusTopBarPrimary();
      return (
        <Pressable role="button" onPress={focusPrimary}>
          <Text>Revenir au filtre</Text>
        </Pressable>
      );
    }
    const aiRun = { words: "Réponse du coach", stopLabel: "Arrêter la réponse du coach", stop: () => {} };
    function Page() {
      const [running, setRunning] = useState(false);
      return (
        <Shell page={home} paneContent={null} sidebar={() => null} onNewConversation={() => {}} aiRun={running ? aiRun : null}>
          <Screen />
          <Pressable role="button" onPress={() => setRunning(true)}>
            <Text>Lancer une action IA</Text>
          </Pressable>
        </Shell>
      );
    }
    await renderInApp(<Page />);
    const user = userEvent.setup();
    await user.press(button("Revenir au filtre"));
    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ props: expect.objectContaining({ accessibilityLabel: "Filtrer les offres" }) }), "focus");

    await user.press(button("Lancer une action IA"));
    noButton("Filtrer les offres");
    await user.press(button("Revenir au filtre"));
    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ props: expect.objectContaining({ testID: "top-bar-more" }) }), "focus");
  });

  it("takes the screen's action back when the screen goes", async () => {
    function Screen() {
      useTopBarPrimary({ label: "Filtrer les offres", icon: Square, run: () => {} });
      return null;
    }
    function Page() {
      const [shown, setShown] = useState(true);
      return shown ? <><Screen /><Pressable role="button" onPress={() => setShown(false)}><Text>Quitter</Text></Pressable></> : null;
    }
    await renderWith(home, {}, <Page />);
    expect(button("Filtrer les offres")).toBeOnTheScreen();
    await userEvent.setup().press(button("Quitter"));
    noButton("Filtrer les offres");
    expect(button("Activité")).toBeOnTheScreen();
  });

  it("shows « Activité IA » and its stop icon while a reply is on its way, then puts it back under « … », VoiceOver's focus on « … »", async () => {
    const stop = jest.fn();
    const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    function Screen() {
      useTopBarPrimary({ label: "Filtrer les offres", icon: Square, run: () => {} });
      return null;
    }
    const aiRun = { words: "Réponse du coach · Démarrage", stopLabel: "Arrêter la réponse du coach", stop };
    // The reply ends once stopped, as the page's conversation has it.
    function Page() {
      const [running, setRunning] = useState(true);
      stop.mockImplementation(() => setRunning(false));
      return (
        <Shell page={home} paneContent={null} sidebar={() => null} onNewConversation={() => {}} actions={[clearAction]} aiRun={running ? aiRun : null}>
          <Screen />
        </Shell>
      );
    }
    await renderInApp(<Page />);
    expect(button("Activité IA · Réponse du coach · Démarrage")).toBeOnTheScreen();
    noButton("Filtrer les offres");
    await userEvent.setup().press(button("Arrêter la réponse du coach"));
    expect(stop).toHaveBeenCalledTimes(1);
    noButton("Arrêter la réponse du coach");
    expect(button("Filtrer les offres")).toBeOnTheScreen();
    expect(focus).toHaveBeenCalledWith(expect.anything(), "focus");
    const offered = answerActionSheet();
    await userEvent.setup().press(button("Autres actions"));
    expect(offered[0]).toEqual(["Activité", "Effacer la conversation", "Nouvelle conversation", "Annuler"]);
  });

  it("opens its menu under « … » on Android, each entry with its words, « Fermer » closing it", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await renderWith(application);
    const user = userEvent.setup();
    await user.press(button("Autres actions"));
    expect(screen.getAllByRole("menuitem").map((item) => item.props.accessibilityLabel)).toEqual(["Effacer la conversation", "Nouvelle conversation"]);
    await user.press(screen.getByRole("menuitem", { name: "Effacer la conversation" }));
    expect(clear).toHaveBeenCalled();
    expect(screen.queryByRole("menuitem")).toBeNull();
    await user.press(button("Autres actions"));
    await user.press(button("Fermer"));
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("is a wide bar again from 64rem: each action a button with its words, no « … »", async () => {
    setWindow(IPAD_LANDSCAPE);
    await renderWith(application);
    for (const name of ["Effacer", "Fiche", "Nouvelle conversation"]) expect(button(name)).toBeOnTheScreen();
    noButton("Autres actions");
    expect(wordsInTopBar()).toEqual(expect.arrayContaining(["Effacer", "Fiche", "Masquer le menu"]));
  });
});

describe("Shell, its Top Bar's title", () => {
  /** What the device lays out: the Top Bar `bar` points wide, its menu button and its buttons at the end as wide as given. */
  const laidOut = async (bar: number, menu: number, end: number) => {
    const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 60 } } });
    await fireEvent(screen.getByTestId("top-bar"), "layout", layout(bar));
    await fireEvent(screen.getByTestId("top-bar-menu"), "layout", layout(menu));
    await fireEvent(screen.getByTestId("top-bar-end"), "layout", layout(end));
  };
  const besideTheButtons = (title: string) => within(screen.getByTestId("top-bar-row")).queryByText(title) !== null;
  const candidatures: ShellPage = { key: "/candidatures", title: "Mes candidatures", pane: "activite" };

  it("stays beside the buttons where it has room for its words", async () => {
    setWindow({ width: 800, height: 1280 });
    await renderShell(candidatures);
    await laidOut(800, 100, 170);
    expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();
    expect(besideTheButtons("Mes candidatures")).toBe(true);
  });

  // A folded phone (412 pt), « Menu », « Activité » and the pencil beside it: « Mes candida / tures », and at the largest
  // text size one or two letters a line, the Top Bar taking most of the screen (#705).
  it("goes on its own line under them where they would leave it less than its words need", async () => {
    setWindow({ width: 412, height: 800 });
    await renderShell(candidatures);
    await laidOut(412, 100, 170);
    expect(screen.getByText("Mes candidatures")).toBeOnTheScreen();
    expect(besideTheButtons("Mes candidatures")).toBe(false);
    expect(button("Menu")).toBeOnTheScreen();
    expect(button("Activité")).toBeOnTheScreen();
    // More buttons than one line holds beside the menu (« Effacer », « Activité », the pencil) wrap, none past the edge.
    expect(StyleSheet.flatten(screen.getByTestId("top-bar-end").props.style)).toMatchObject({ flexShrink: 1, flexWrap: "wrap" });
  });

  it("goes on its own line at the largest text size, and back beside them when the window has room again", async () => {
    setWindow({ width: 412, height: 800, fontScale: 2 });
    await renderShell(candidatures);
    await laidOut(412, 180, 290);
    expect(besideTheButtons("Mes candidatures")).toBe(false);

    await act(() => setWindow({ width: 1280, height: 800, fontScale: 2 }));
    await laidOut(1280, 180, 290);
    expect(besideTheButtons("Mes candidatures")).toBe(true);
  });

  // An iPhone SE at iOS's largest (3.57): « Menu », « Activité » broken mid-word and the title took the whole screen,
  // the conversation under them no room left (#705). The Top Bar's words grow to twice their size at most; « Menu » and
  // « Activité » are icons there now (#899).
  it("lets its words grow to twice their size at most, the conversation keeping its room", async () => {
    setWindow({ width: 375, height: 667, fontScale: 3.571 });
    await renderShell(candidatures);
    await laidOut(375, 44, 96);
    expect(screen.getByText("Mes candidatures")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.queryByText("Menu")).toBeNull();
    expect(button("Activité")).toBeOnTheScreen();
    expect(besideTheButtons("Mes candidatures")).toBe(false);
  });

  it("lets the wide bar's words grow to twice their size at most", async () => {
    setWindow({ width: 1366, height: 1024, fontScale: 1.3 });
    await renderShell(candidatures);
    const topBar = within(screen.getByTestId("top-bar"));
    for (const words of ["Masquer le menu", "Activité", "Mes candidatures"]) expect(topBar.getByText(words)).toHaveProp("maxFontSizeMultiplier", 2);
  });

  // The same iPhone SE: a 1rem gutter each side of the conversation, 57 pt at that size, left its words 261 of the
  // window's 375 points, and they broke mid-word (#905). Full page, the gutter stops growing at 16 pt.
  it("keeps the conversation the window's width at the largest text size, a 16 pt margin each side", async () => {
    setWindow({ width: 375, height: 667, fontScale: 3.571 });
    await renderShell(candidatures);
    expect(StyleSheet.flatten(screen.getByTestId("shell-conversation").props.style)).toMatchObject({ marginHorizontal: 16 });
  });

  it("keeps the link back to the page above it on its own line", async () => {
    setWindow({ width: 412, height: 800 });
    const onUp = jest.fn();
    await renderInApp(
      <Shell page={{ ...application, up: { path: "/candidatures", label: "Mes candidatures" } }} onUp={onUp} paneContent={null} sidebar={() => null} onNewConversation={() => {}}>
        <Text>La conversation</Text>
      </Shell>,
    );
    await laidOut(412, 100, 140);
    expect(besideTheButtons("Aéroline")).toBe(false);
    await userEvent.setup().press(screen.getByRole("link", { name: "Aéroline" }));
    expect(onUp).toHaveBeenCalledWith("/candidatures");
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
      web.client,
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

// On an iPhone SE the keyboard covered the Interview form's last field and its label; nothing but a tap on the
// keyboard's own keys closed it there (the number keyboards have no key that does). A drag in the pane closes it, as in
// the iOS apps that scroll a form (#705).
describe("Shell, a pane's keyboard", () => {
  beforeEach(() => setWindow(PHONE));

  it("closes as the pane is dragged", async () => {
    await renderShell();
    await userEvent.setup().press(button("Fiche"));
    expect(screen.getByTestId("pane-body").props.keyboardDismissMode).toBe("on-drag");
  });
});
