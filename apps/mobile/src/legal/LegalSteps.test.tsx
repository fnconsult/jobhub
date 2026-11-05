import { screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { createApi } from "../api/api";
import { createAppSession } from "../session/app-session";
import { SessionGate } from "../session/SessionGate";
import { fakeWebApp, memoryStorage, memoryWebViewCookies, shownLegalText, TEST_BASE_URL } from "../session/testing";
import { renderInApp } from "../testing";
import { LegalSteps } from "./LegalSteps";

const EMAIL = "marie.dupont@example.fr";

/** The app signed in as Marie, the web app asking of her what `asks` says, the app behind its legal steps. */
async function signedIn(asks: Parameters<ReturnType<typeof fakeWebApp>["asks"]>[1] = {}, { apiReachable = true } = {}) {
  const web = fakeWebApp();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), webViewCookies: memoryWebViewCookies(), fetch: web.fetch });
  await session.askLink(EMAIL);
  await session.openLink(web.linkFor(EMAIL));
  web.asks(EMAIL, asks);
  const unreachable = () => Promise.reject(new TypeError("Network request failed"));
  const api = createApi({ baseURL: TEST_BASE_URL, cookie: () => session.cookie(), fetch: apiReachable ? web.fetch : unreachable });
  await renderInApp(
    <SessionGate session={session} link={null}>
      <LegalSteps>
        <Text>La conversation</Text>
      </LegalSteps>
    </SessionGate>,
    { api },
  );
  /** The writes the app sent the web app. */
  const writes = () => web.recorded.filter((call) => call.method !== "GET").map(({ method, path, body, client }) => ({ method, path, body, client }));
  return { web, writes, user: userEvent.setup() };
}


describe("the legal steps after sign-in, native (#689, ADR-0062, ADR-0072)", () => {
  it("goes straight on when nothing is asked", async () => {
    await signedIn();

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("shows the CGU version to accept with its text, the repo's Markdown, and records the Acceptance from the app", async () => {
    const { writes, user } = await signedIn({ acceptance: shownLegalText("cgu", "2026-12-01") });

    expect(await screen.findByText("Nos conditions d'utilisation")).toBeOnTheScreen();
    expect(screen.getByText("Conditions générales d'utilisation")).toBeOnTheScreen();
    expect(screen.getByText("Jobbbox vous aide à chercher un emploi.")).toBeOnTheScreen();
    expect(screen.getByText("1. Objet")).toBeOnTheScreen();
    expect(screen.getByText(/les Candidats\./)).toBeOnTheScreen();
    expect(screen.getByText("un coach IA")).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();
    // The box is never ticked for the Candidate: « Accepter et continuer » waits for it.
    expect(screen.getByRole("button", { name: "Accepter et continuer" })).toBeDisabled();

    await user.press(screen.getByRole("checkbox", { name: "J'accepte les CGU (version du 01/12/2026)" }));
    await user.press(screen.getByRole("button", { name: "Accepter et continuer" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    expect(writes()).toEqual([{ method: "POST", path: "/api/account/acceptances", body: { text: "cgu", version: "2026-12-01", accepted: true }, client: "mobile" }]);
  });

  it("leaves Mes données and the subscription a press away while the CGU wait, and nothing else", async () => {
    const { user } = await signedIn({ acceptance: shownLegalText("cgu", "2026-12-01") });

    await user.press(await screen.findByRole("button", { name: "Mes données" }));

    expect((await screen.findByTestId("web-view")).props.source).toEqual({ uri: `${TEST_BASE_URL}/compte/donnees` });
    await user.press(screen.getByRole("button", { name: "Retour" }));
    await user.press(screen.getByRole("button", { name: "Abonnement" }));
    expect((await screen.findByTestId("web-view")).props.source).toEqual({ uri: `${TEST_BASE_URL}/abonnement` });
    expect(screen.queryByText("La conversation")).toBeNull();
  });

  it("shows the privacy policy's change once, with its text; « J'ai compris » closes it for good", async () => {
    const { writes, user } = await signedIn({ privacyChange: shownLegalText("confidentialite", "2026-12-01") });

    expect(await screen.findByText("Notre politique de confidentialité a changé le 1 décembre 2026.")).toBeOnTheScreen();
    expect(screen.getByText("Politique de confidentialité")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "J'ai compris" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    expect(writes()).toEqual([{ method: "DELETE", path: "/api/privacy-change/2026-12-01", body: undefined, client: "mobile" }]);
  });

  it("asks the EU AI Consent when it is missing, and records it given", async () => {
    const { writes, user } = await signedIn({ euAiConsentGiven: false });

    expect(await screen.findByText("IA européenne pour vos données d'identité")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Donner mon accord" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    expect(writes()).toEqual([{ method: "PUT", path: "/api/account/eu-ai-consent", body: undefined, client: "mobile" }]);
  });

  it("lets the Candidate go on without the EU AI Consent: « Plus tard » records nothing", async () => {
    const { writes, user } = await signedIn({ euAiConsentGiven: false });

    await user.press(await screen.findByRole("button", { name: "Plus tard" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    expect(writes()).toEqual([]);
  });

  it("asks each in turn: the CGU first, then the privacy policy's change, then the EU AI Consent", async () => {
    const { user } = await signedIn({ acceptance: shownLegalText("cgu", "2026-12-01"), privacyChange: shownLegalText("confidentialite", "2026-12-01"), euAiConsentGiven: false });

    await user.press(await screen.findByRole("checkbox", { name: "J'accepte les CGU (version du 01/12/2026)" }));
    await user.press(screen.getByRole("button", { name: "Accepter et continuer" }));
    await user.press(await screen.findByRole("button", { name: "J'ai compris" }));
    await user.press(await screen.findByRole("button", { name: "Plus tard" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("goes on when the steps cannot be read: nothing is asked then, as on the web", async () => {
    await signedIn({ acceptance: shownLegalText("cgu", "2026-12-01") }, { apiReachable: false });

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });
});
