import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import { hardwareKeyboard, renderInApp } from "../testing";
import { SampleConversation } from "./SampleConversation";

describe("Conversation, on sample data until #690", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("says the coach is an AI before anything is written", async () => {
    await renderInApp(<SampleConversation />);
    expect(screen.getByText(/Je suis un coach IA, pas une personne/)).toBeOnTheScreen();
  });

  it("sends what was typed, offers « Arrêter » while the reply streams, and « Envoyer » again once stopped", async () => {
    await renderInApp(<SampleConversation />);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    await user.type(screen.getByLabelText("Votre message"), "Aide-moi à préparer un entretien");
    await user.press(screen.getByRole("button", { name: "Envoyer" }));
    expect(screen.getByText("Aide-moi à préparer un entretien")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Envoyer" })).toBeNull();

    await user.press(screen.getByRole("button", { name: "Arrêter" }));
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeOnTheScreen();
  });

  it("lets the reply finish on its own", async () => {
    await renderInApp(<SampleConversation />);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");
    await user.press(screen.getByRole("button", { name: "Envoyer" }));
    await act(() => jest.runAllTimers());
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeOnTheScreen();
  });

  it("has « + » to add a link or a document", async () => {
    await renderInApp(<SampleConversation />);
    expect(screen.getByRole("button", { name: "Joindre un lien ou un document" })).toBeOnTheScreen();
  });
});

describe("Conversation's thread, when the window changes (rotation, Split View, Stage Manager, a foldable)", () => {
  // The thread's native scroll view, as Jest's React Native preset stands it in.
  const scrollToEnd = () => (ScrollView.prototype as unknown as { scrollToEnd: jest.Mock }).scrollToEnd;
  const thread = () => screen.getByLabelText("Vos échanges avec votre coach");
  /** The person scrolls the thread to `y`, out of `height` points of messages, 500 of them in view. */
  const scrollTo = (y: number, height = 2000) =>
    fireEvent.scroll(thread(), { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 600, height }, layoutMeasurement: { width: 600, height: 500 } } });
  /** The window narrows or widens: the messages wrap again and the thread grows or shrinks. */
  const rewrap = (height: number) => fireEvent(thread(), "contentSizeChange", 600, height);

  beforeEach(() => scrollToEnd().mockClear());

  it("stays where the person scrolled it, back up in the thread", async () => {
    await renderInApp(<SampleConversation />);
    await scrollTo(300);
    await rewrap(2600);
    expect(scrollToEnd()).not.toHaveBeenCalled();
  });

  it("keeps the latest message in view when the person was reading it", async () => {
    await renderInApp(<SampleConversation />);
    await scrollTo(1500);
    await rewrap(2600);
    expect(scrollToEnd()).toHaveBeenCalled();
  });
});

describe("Conversation, with a hardware keyboard", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends the draft with ⌘↩, listed in the ⌘ panel", async () => {
    await renderInApp(<SampleConversation />);
    expect(hardwareKeyboard.panel()).toContain("⌘↩ Envoyer le message");
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");

    await hardwareKeyboard.press("⌘↩");
    expect(screen.getByText("Bonjour")).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre message")).toHaveDisplayValue("");
  });

  it("withdraws ⌘↩ while the reply streams, « Arrêter » being the box's button then", async () => {
    await renderInApp(<SampleConversation />);
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.type(screen.getByLabelText("Votre message"), "Bonjour");
    await hardwareKeyboard.press("⌘↩");
    expect(hardwareKeyboard.panel()).not.toContain("⌘↩ Envoyer le message");
    await act(() => jest.runAllTimers());
    expect(hardwareKeyboard.panel()).toContain("⌘↩ Envoyer le message");
  });
});
