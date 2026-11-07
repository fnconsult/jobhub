import { render, screen } from "@testing-library/react-native";
import { AppText, CappedTextScale } from "./AppText";

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

// An iPhone SE at iOS's largest: the Top Bar's « Menu », « Activité » (broken mid-word) and the page's title took the
// whole screen, the conversation under them no room left (#705). A bar's words grow to twice their size at most.
describe("AppText in a bar (#705)", () => {
  it("grows up to the bar's scale, body text and buttons' words included", async () => {
    await render(
      <CappedTextScale scale={2}>
        <AppText weight="semiBold">Activité</AppText>
        <AppText variant="lead">Mes candidatures</AppText>
        <AppText variant="h1">Un titre</AppText>
      </CappedTextScale>,
    );
    expect(screen.getByText("Activité")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByText("Mes candidatures")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByText("Un titre")).toHaveProp("maxFontSizeMultiplier", 2);
  });

  it("keeps the smaller of a title's and the bar's scales", async () => {
    await render(
      <CappedTextScale scale={3}>
        <AppText variant="h1">Un titre</AppText>
        <AppText>Un texte</AppText>
      </CappedTextScale>,
    );
    expect(screen.getByText("Un titre")).toHaveProp("maxFontSizeMultiplier", 2);
    expect(screen.getByText("Un texte")).toHaveProp("maxFontSizeMultiplier", 3);
  });
});
