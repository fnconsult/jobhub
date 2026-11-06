import { render, screen } from "@testing-library/react-native";
import { AppText } from "./AppText";

// The Maestro flows saw « Se connecter à Jobbbox » broken mid-word, « conn / ecter », on an iPhone SE at the largest
// text size (#705): a title grows with the system's text size, up to twice its size, so its words stay whole.
describe("AppText at a large system text size (#705)", () => {
  it("lets a page's and a section's title grow to twice their size at most", async () => {
    await render(
      <>
        <AppText variant="h1">Se connecter à Jobbbox</AppText>
        <AppText variant="h2">Vos recherches par profil</AppText>
      </>,
    );
    expect(screen.getByText("Se connecter à Jobbbox")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByText("Vos recherches par profil")).toHaveProp("maxFontSizeMultiplier", 2);
  });

  it("lets body text and smaller titles grow as far as the system takes them", async () => {
    await render(
      <>
        <AppText>Votre coach pour décrocher votre prochain poste après 40 ans.</AppText>
        <AppText variant="h3">Entretiens</AppText>
      </>,
    );
    expect(screen.getByText(/Votre coach/).props.maxFontSizeMultiplier).toBeUndefined();
    expect(screen.getByText("Entretiens").props.maxFontSizeMultiplier).toBeUndefined();
  });
});
