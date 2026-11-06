import { screen } from "@testing-library/react-native";
import { Plus } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { renderInApp, setWindow } from "../testing";
import { Control } from "./Control";

// A folded foldable at the largest text size: « Ajouter une candidature » ran past the right edge of the suggestions,
// its end cut (#705, the foldable's key screens). Its words wrap within the room it has, as any text does.
describe("Control, its words wider than the room it has (#705)", () => {
  beforeEach(() => setWindow({ width: 412, height: 800, fontScale: 2 }));

  it("is never wider than what holds it, and its words wrap within it", async () => {
    await renderInApp(<Control label="Ajouter une candidature" icon={Plus} look="secondary" onPress={() => {}} />);
    const button = screen.getByRole("button", { name: "Ajouter une candidature" });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ maxWidth: "100%" });
    const words = screen.getByText("Ajouter une candidature");
    expect(StyleSheet.flatten(words.parent!.props.style)).toMatchObject({ flexShrink: 1 });
  });
});

// The Interview form's button is named as the form's title, « Ajouter l'entretien »: the e2e flows find it by its id.
describe("Control, its id for the e2e flows (#705)", () => {
  it("carries the testID its caller gives", async () => {
    await renderInApp(<Control testID="interview-submit" label="Ajouter l'entretien" look="primary" onPress={() => {}} />);
    expect(screen.getByTestId("interview-submit")).toBe(screen.getByRole("button", { name: "Ajouter l'entretien" }));
  });
});
