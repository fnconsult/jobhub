import { act, screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { Pressable } from "react-native";
import { renderInApp, setWindow } from "../testing";
import { SampleConversation } from "../conversation/SampleConversation";
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

async function renderShell(page: ShellPage = application) {
  await renderInApp(
    <Shell page={page} paneContent={<><Text>Contenu de la Fiche</Text><SectionLink /></>} sidebar={() => <Text>Mes candidatures</Text>} onNewConversation={() => {}}>
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
    await renderInApp(
      <Shell page={application} paneContent={<Text>Contenu de la Fiche</Text>} sidebar={() => <Text>Mes candidatures</Text>} onNewConversation={() => {}}>
        <SampleConversation />
      </Shell>,
    );
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.type(screen.getByLabelText("Votre message"), "Ma question");
    await user.press(button("Envoyer"));
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
