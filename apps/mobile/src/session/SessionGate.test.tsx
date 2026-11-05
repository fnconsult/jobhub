import { SECOND_STEP_PATH } from "@jobhub/shared";
import { useQuery } from "@tanstack/react-query";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";
import { useSyncExternalStore } from "react";
import { AppState, Text } from "react-native";
import { renderInApp } from "../testing";
import { Control } from "../ui/Control";
import { fakeWebView } from "../testing-device";
import { createAppSession, type DevicePasskeys } from "./app-session";
import { SessionGate, useSession } from "./SessionGate";
import { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } from "./testing";

const EMAIL = "marie.dupont@example.fr";
const OTHER_EMAIL = "paul.martin@example.fr";

/** How many times the signed-in page has read the web app; a read kept for good, as the legal steps' is. */
let reads = 0;

// Typing an address and a code key by key, on a loaded CI runner, takes longer than Jest's 5 s (the first test also pays
// for rendering the app cold).
jest.setTimeout(30_000);

function SignedInPage() {
  const { signOut, recheck } = useSession();
  const read = useQuery({ queryKey: ["legalSteps", "fr"], queryFn: async () => `Lecture n°${++reads}`, staleTime: Infinity });
  return (
    <>
      <Text>La conversation</Text>
      {read.data ? <Text>{read.data}</Text> : null}
      <Control label="Se déconnecter" onPress={signOut} />
      {/* What a web page does when it lands on /connexion or /compte/supprime (WebPage). */}
      <Control label="Page de fin de session" onPress={recheck} />
    </>
  );
}

function setUp({ passkeys }: { passkeys?: (web: ReturnType<typeof fakeWebApp>) => DevicePasskeys } = {}) {
  reads = 0;
  const web = fakeWebApp();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch, passkeys: passkeys?.(web) ?? web.deviceWithoutPasskey(), webViewCookies: memoryWebViewCookies() });
  /** The address the system last opened the app with, as Expo Linking's useLinkingURL gives it. */
  const opened = { current: null as string | null, listeners: new Set<() => void>() };
  const subscribe = (listener: () => void) => (opened.listeners.add(listener), () => void opened.listeners.delete(listener));
  function App() {
    const link = useSyncExternalStore(subscribe, () => opened.current);
    return (
      <SessionGate session={session} link={link}>
        <SignedInPage />
      </SessionGate>
    );
  }
  /** The app started, opened with `link` if any (a cold start). */
  const render = (link: string | null = null) => ((opened.current = link), renderInApp(<App />));
  /** The system opens the running app with `link`, as a universal link or an App Link does. */
  const openWith = (link: string) => act(async () => ((opened.current = link), opened.listeners.forEach((listener) => listener())));
  return { web, session, render, openWith };
}

const LINK_ERROR = "Ce lien de connexion n'est plus valable. Demandez-en un nouveau ci-dessous.";

/** The app comes back to the foreground, as after reading the email or using the web. */
async function backToForeground() {
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter(([event]) => event === "change").map(([, listener]) => listener);
  await act(async () => listeners.forEach((listener) => listener("active")));
}

describe("SessionGate (#685)", () => {
  it("asks the email, sends the link and waits for it", async () => {
    const { web, render } = setUp();
    await render();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Votre adresse e-mail"), EMAIL);
    await user.press(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));

    expect(await screen.findByText(/Nous avons envoyé un lien de connexion à marie\.dupont@example\.fr/)).toBeOnTheScreen();
    expect(screen.getByText("En attente du lien…")).toBeOnTheScreen();
    expect(web.emailed).toHaveLength(1);
    expect(screen.queryByText("La conversation")).toBeNull();

    await user.press(screen.getByRole("button", { name: "Changer d'adresse e-mail" }));
    expect(screen.getByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
  });

  it("says when the link cannot be sent", async () => {
    const { web, render } = setUp();
    await render();
    web.setOffline(true);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Votre adresse e-mail"), EMAIL);
    await user.press(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));

    expect(await screen.findByText("Une erreur est survenue. Vérifiez votre adresse e-mail et réessayez.")).toBeOnTheScreen();
  });

  it("opens the app signed in when the link opens it", async () => {
    const { web, session, render } = setUp();
    await session.askLink(EMAIL);

    await render(web.linkFor(EMAIL));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("says when the link is no longer valid, on the sign-in screen", async () => {
    const { web, session, render } = setUp();
    await session.askLink(EMAIL);
    const link = web.linkFor(EMAIL);
    await session.openLink(link);
    await session.signOut();

    await render(link);

    expect(await screen.findByText(LINK_ERROR)).toBeOnTheScreen();
    expect(screen.getByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
  });

  it("says when the link is no longer valid while waiting for it, and sends another with « Renvoyer le lien »", async () => {
    const { web, session, render, openWith } = setUp();
    await session.askLink(EMAIL);
    const used = web.linkFor(EMAIL);
    await session.openLink(used);
    await session.signOut();
    await render();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Votre adresse e-mail"), EMAIL);
    await user.press(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));
    await screen.findByText("En attente du lien…");

    await openWith(used);

    expect(await screen.findByText(LINK_ERROR)).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();
    await user.press(screen.getByRole("button", { name: "Renvoyer le lien" }));
    expect(web.emailed).toHaveLength(3);
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
    await openWith(web.linkFor(EMAIL));
    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("no longer says a link is not valid once a new one is sent", async () => {
    const { web, session, render } = setUp();
    await session.askLink(EMAIL);
    const used = web.linkFor(EMAIL);
    await session.openLink(used);
    await session.signOut();
    await render(used);
    await screen.findByText(LINK_ERROR);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Votre adresse e-mail"), EMAIL);
    await user.press(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));

    expect(await screen.findByText("En attente du lien…")).toBeOnTheScreen();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
  });

  it("signs out: the session revoked, back to sign-in", async () => {
    const { web, session, render } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));

    await userEvent.setup().press(await screen.findByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();
    expect(web.sessionCount()).toBe(0);
  });

  it("is back to sign-in once the session is revoked on the web, when the app comes back to the foreground", async () => {
    const { web, session, render } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));
    await screen.findByText("La conversation");

    web.revokeAll(EMAIL);
    await backToForeground();

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
  });

  it("forgets the read cache when a web page ends the session, so the next sign-in reads afresh (#689)", async () => {
    const { web, session, render, openWith } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));
    expect(await screen.findByText("Lecture n°1")).toBeOnTheScreen();

    // The account deleted, or signed out, in a WebView: the session is gone on the web app, then read again.
    web.revokeAll(EMAIL);
    await userEvent.setup().press(screen.getByRole("button", { name: "Page de fin de session" }));
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(screen.queryByText(LINK_ERROR)).toBeNull();

    await session.askLink(OTHER_EMAIL);
    await openWith(web.linkFor(OTHER_EMAIL));
    expect(await screen.findByText("Lecture n°2")).toBeOnTheScreen();
    expect(screen.queryByText("Lecture n°1")).toBeNull();
  });

  it("forgets the read cache when the session is found revoked as the app comes back to the foreground", async () => {
    const { web, session, render, openWith } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));
    await screen.findByText("Lecture n°1");

    web.revokeAll(EMAIL);
    await backToForeground();
    await screen.findByLabelText("Votre adresse e-mail");

    await session.askLink(OTHER_EMAIL);
    await openWith(web.linkFor(OTHER_EMAIL));
    expect(await screen.findByText("Lecture n°2")).toBeOnTheScreen();
  });

  describe("the email's code (#686)", () => {
    /** Asks the link on the sign-in screen, as a person does, until it waits for it. */
    async function askLinkOnScreen(user: ReturnType<typeof userEvent.setup>) {
      await user.type(await screen.findByLabelText("Votre adresse e-mail"), EMAIL);
      await user.press(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));
      await screen.findByText("En attente du lien…");
    }

    it("is offered beside the wait for the link, with the number pad and the system's code filling", async () => {
      const { web, render } = setUp();
      await render();
      const user = userEvent.setup();
      await askLinkOnScreen(user);

      const field = screen.getByLabelText("Saisir le code reçu par e-mail");
      expect(field.props).toMatchObject({ keyboardType: "number-pad", textContentType: "oneTimeCode", inputMode: "numeric" });
      await user.type(field, web.codeFor(EMAIL));
      await user.press(screen.getByRole("button", { name: "Me connecter avec ce code" }));

      expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    });

    it("says when the code is wrong, then when it no longer works, and a new email brings another", async () => {
      const { web, render } = setUp();
      await render();
      const user = userEvent.setup();
      await askLinkOnScreen(user);
      const first = web.codeFor(EMAIL);

      for (let tries = 0; tries < 5; tries++) {
        await user.clear(screen.getByLabelText("Saisir le code reçu par e-mail"));
        await user.type(screen.getByLabelText("Saisir le code reçu par e-mail"), "000000");
        await user.press(screen.getByRole("button", { name: "Me connecter avec ce code" }));
        expect(await screen.findByText(/Ce code ne convient pas/)).toBeOnTheScreen();
      }
      await user.clear(screen.getByLabelText("Saisir le code reçu par e-mail"));
      await user.type(screen.getByLabelText("Saisir le code reçu par e-mail"), first);
      await user.press(screen.getByRole("button", { name: "Me connecter avec ce code" }));
      expect(await screen.findByText("Trop d'essais : ce code ne fonctionne plus. Demandez un nouvel e-mail.")).toBeOnTheScreen();

      await user.press(screen.getByRole("button", { name: "Renvoyer le lien" }));
      expect(web.emailed).toHaveLength(2);
      expect(screen.queryByText(/Trop d'essais/)).toBeNull();
      await user.type(screen.getByLabelText("Saisir le code reçu par e-mail"), web.codeFor(EMAIL));
      await user.press(screen.getByRole("button", { name: "Me connecter avec ce code" }));
      expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    });

    it("leads to the second step for an account that has it", async () => {
      const { web, render } = setUp();
      web.withSecondStep(EMAIL);
      await render();
      const user = userEvent.setup();
      await askLinkOnScreen(user);

      await user.type(screen.getByLabelText("Saisir le code reçu par e-mail"), web.codeFor(EMAIL));
      await user.press(screen.getByRole("button", { name: "Me connecter avec ce code" }));

      expect(await screen.findByText("Vérification en deux étapes")).toBeOnTheScreen();
    });
  });
});

describe("the second step, native (#688)", () => {
  /** Opens the app with the emailed link of `email`, whose account has Two-step verification as `factors` say. */
  async function pendingApp(email = EMAIL, factors: { app?: boolean; passkey?: boolean } = {}, options?: Parameters<typeof setUp>[0]) {
    const app = setUp(options);
    app.web.withSecondStep(email, factors);
    await app.session.askLink(email);
    await app.render(app.web.linkFor(email));
    await screen.findByText("Vérification en deux étapes");
    return app;
  }

  it("asks the authenticator app's code, and nothing else of the app is reached", async () => {
    await pendingApp();

    expect(await screen.findByText("Pour terminer votre connexion, saisissez le code à 6 chiffres affiché par votre application d'authentification.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Code de l'application")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Utiliser un code de secours" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Utiliser une clé d'accès" })).toBeNull();
    expect(screen.queryByText("La conversation")).toBeNull();
  });

  it("is reached the same after signing in with the email's code (#686), and released there", async () => {
    const { web, render } = setUp();
    web.withSecondStep(EMAIL);
    await render();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Votre adresse e-mail"), EMAIL);
    await user.press(screen.getByRole("button", { name: "Recevoir mon lien de connexion" }));
    await user.type(await screen.findByLabelText("Saisir le code reçu par e-mail"), web.codeFor(EMAIL));
    await user.press(screen.getByRole("button", { name: "Me connecter avec ce code" }));

    await user.type(await screen.findByLabelText("Code de l'application"), web.appCode());
    expect(screen.queryByText("La conversation")).toBeNull();
    await user.press(screen.getByRole("button", { name: "Vérifier" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("is released by a valid code: the app opens", async () => {
    const { web } = await pendingApp();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Code de l'application"), web.appCode());
    await user.press(screen.getByRole("button", { name: "Vérifier" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("takes a backup code instead", async () => {
    const { web } = await pendingApp();
    const user = userEvent.setup();

    await user.press(await screen.findByRole("button", { name: "Utiliser un code de secours" }));
    expect(screen.getByText("Pour terminer votre connexion, saisissez l'un de vos codes de secours. Chacun ne sert qu'une fois.")).toBeOnTheScreen();
    await user.type(screen.getByLabelText("Code de secours"), web.backupCode(EMAIL));
    await user.press(screen.getByRole("button", { name: "Vérifier" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("says a code is wrong, then when the limit is reached, the session staying pending", async () => {
    await pendingApp();
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Code de l'application");

    await user.type(field, "000000");
    await user.press(screen.getByRole("button", { name: "Vérifier" }));
    expect(await screen.findByText("Ce code n'est pas valide. Vérifiez-le et réessayez.")).toBeOnTheScreen();
    for (let attempt = 2; attempt <= 5; attempt++) await user.press(screen.getByRole("button", { name: "Vérifier" }));

    expect(await screen.findByText(/^Trop de codes erronés\. Réessayez à \d{2}:\d{2}\.$/)).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();
  });

  it("offers « Utiliser une clé d'accès » when the account has one, which the system asks for", async () => {
    await pendingApp(EMAIL, { app: false, passkey: true }, { passkeys: (web) => web.deviceWithPasskeyOf(EMAIL) });

    // Without an app, the code is a backup code.
    expect(await screen.findByLabelText("Code de secours")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "Utiliser une clé d'accès" }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
  });

  it("refuses a passkey of another account, the session staying pending", async () => {
    await pendingApp(EMAIL, { passkey: true }, { passkeys: (web) => (web.withSecondStep("paul.martin@example.fr", { passkey: true }), web.deviceWithPasskeyOf("paul.martin@example.fr")) });

    await userEvent.setup().press(await screen.findByRole("button", { name: "Utiliser une clé d'accès" }));

    expect(await screen.findByText("Cette clé d'accès n'est pas enregistrée sur ce compte. Utilisez une autre clé ou un code.")).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();
  });

  it("says when the passkey was not used", async () => {
    await pendingApp(EMAIL, { passkey: true });

    await userEvent.setup().press(await screen.findByRole("button", { name: "Utiliser une clé d'accès" }));

    expect(await screen.findByText("La clé d'accès n'a pas été utilisée. Réessayez, ou utilisez un code.")).toBeOnTheScreen();
  });

  it("can still sign out", async () => {
    const { web } = await pendingApp();

    await userEvent.setup().press(await screen.findByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(web.sessionCount()).toBe(0);
  });

  it("sends an account that must have it and has none (a Human Coach) to the setup, in a WebView of the web, then back", async () => {
    fakeWebView.reset();
    const { web, session, render } = setUp();
    web.mustSetUp("claire.coach@example.fr");
    await session.askLink("claire.coach@example.fr");
    await render(web.linkFor("claire.coach@example.fr"));
    const user = userEvent.setup();

    expect(await screen.findByText(/la vérification en deux étapes y est obligatoire/)).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Configurer la vérification" }));
    await waitFor(() => expect(fakeWebView.shown?.source.uri).toBe(`${TEST_BASE_URL}${SECOND_STEP_PATH}`));

    // Set up on the web page, which then goes on to the home page.
    web.finishSetUp("claire.coach@example.fr");
    await act(async () => fakeWebView.shown!.onNavigationStateChange({ url: `${TEST_BASE_URL}/`, loading: false }));

    expect(await screen.findByText("La conversation")).toBeOnTheScreen();
    expect(fakeWebView.shown).toBeNull();
  });

  it("comes back from the setup's WebView with « Fermer », still to set up", async () => {
    fakeWebView.reset();
    const { web, session, render } = setUp();
    web.mustSetUp("claire.coach@example.fr");
    await session.askLink("claire.coach@example.fr");
    await render(web.linkFor("claire.coach@example.fr"));
    const user = userEvent.setup();

    await user.press(await screen.findByRole("button", { name: "Configurer la vérification" }));
    await user.press(await screen.findByRole("button", { name: "Fermer" }));

    expect(await screen.findByRole("button", { name: "Configurer la vérification" })).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();
  });
});
