import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ScrollView, StyleSheet, Text } from "react-native";
import { CoachConversation } from "../coach/CoachConversation";
import { fakeCoachWeb } from "../coach/testing";
import { fakeNetwork } from "../offline/testing";
import { renderInApp, setWindow } from "../testing";

// What it sends and shows is CoachConversation's (its tests); here, how the conversation is drawn: its box, and its thread.

describe("Conversation's box", () => {
  it("has « + » to add a link or a document", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    expect(screen.getByRole("button", { name: "Joindre un lien ou un document" })).toBeOnTheScreen();
  });

  it("gives the box back once the network returns", async () => {
    const network = fakeNetwork(false);
    await renderInApp(<CoachConversation conversationId={null} route="/" />, { ...fakeCoachWeb().client, network });
    await act(() => network.set(true));
    expect(screen.getByLabelText("Votre message")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeEnabled();
    expect(screen.queryByText(/Hors ligne/)).toBeNull();
  });
});

// On a folded foldable the help found while a message was typed, and on an iPhone SE at the largest text size the
// home page's suggestions, took more room than the thread left: the box went under the keyboard, or off the screen, with
// its « Envoyer » (#705, Maestro). What sits above the box scrolls and shrinks; the box keeps its room.
describe("Conversation's box, what sits above it taller than the room left", () => {
  beforeEach(() => setWindow({ width: 375, height: 667, fontScale: 3.571 }));

  it("scrolls what sits above the box, which shrinks, and never the box itself", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" suggestions={<Text>Chercher des offres</Text>} />, fakeCoachWeb().client);
    const box = screen.getByTestId("conversation-box");
    expect(StyleSheet.flatten(box.props.style)).toMatchObject({ flexShrink: 1 });
    const above = screen.getByTestId("conversation-above-box");
    expect(StyleSheet.flatten(above.props.style)).toMatchObject({ flexGrow: 0, flexShrink: 1 });
    expect(above.props.keyboardShouldPersistTaps).toBe("handled");
    expect(within(above).queryByLabelText("Votre message")).toBeNull();
    expect(within(box).getByLabelText("Votre message")).toBeOnTheScreen();
  });
});

// On an iPhone SE at iOS's largest text size, « Envoyer » took the whole box: its words cut in two (« Envoy / er »), run
// past the screen's edge, the message field left no width, the box drawn over the thread (#705, Maestro, iphone-se
// light-largest-text). From the size where texts are shown whole, the box's button is its icon, named « Envoyer ».
describe("Conversation's box, at a large system text size", () => {
  it("draws « Envoyer » as its icon, named by its words, which leaves the field its width", async () => {
    setWindow({ width: 375, height: 667, fontScale: 3.571 });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    const send = screen.getByRole("button", { name: "Envoyer" });
    expect(send).toBeEnabled();
    expect(within(send).queryByText("Envoyer")).toBeNull();
  });

  // Pinned under the box, « Signaler un problème » and « Proposer une idée » took most of an iPhone SE's height at the
  // largest size: the thread, with the page's own view (« Fiche »), was left a strip (#705, Maestro). They then end the
  // thread, which scrolls to them, and the box sits at the bottom.
  it("ends the thread with what sits under the box, which leaves the thread its height", async () => {
    setWindow({ width: 375, height: 667, fontScale: 3.571 });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    const thread = screen.getByLabelText("Vos échanges avec votre coach");
    expect(within(thread).getByRole("button", { name: "Signaler un problème" })).toBeOnTheScreen();
    expect(within(screen.getByTestId("conversation-box")).queryByRole("button", { name: "Signaler un problème" })).toBeNull();
  });

  it("keeps what sits under the box there at the standard size", async () => {
    setWindow({ width: 375, height: 667, fontScale: 1 });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    expect(within(screen.getByTestId("conversation-box")).getByRole("button", { name: "Signaler un problème" })).toBeOnTheScreen();
  });

  it("keeps « Envoyer »'s words at the standard size", async () => {
    setWindow({ width: 375, height: 667, fontScale: 1 });
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    expect(within(screen.getByRole("button", { name: "Envoyer" })).getByText("Envoyer")).toBeOnTheScreen();
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
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    await scrollTo(300);
    await rewrap(2600);
    expect(scrollToEnd()).not.toHaveBeenCalled();
  });

  it("keeps the latest message in view when the person was reading it", async () => {
    await renderInApp(<CoachConversation conversationId={null} route="/" />, fakeCoachWeb().client);
    await scrollTo(1500);
    await rewrap(2600);
    expect(scrollToEnd()).toHaveBeenCalled();
  });
});
