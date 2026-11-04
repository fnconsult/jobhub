import { act, screen, userEvent } from "@testing-library/react-native";
import { renderInApp } from "../testing";
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
