import { act, screen, userEvent } from "@testing-library/react-native";
import { useSyncExternalStore } from "react";
import { AppState, Text } from "react-native";
import { renderInApp } from "../testing";
import { Control } from "../ui/Control";
import { createAppSession } from "./app-session";
import { SessionGate, useSession } from "./SessionGate";
import { fakeWebApp, memoryStorage, TEST_BASE_URL } from "./testing";

const EMAIL = "marie.dupont@example.fr";

// Typing an address and a code key by key, on a loaded CI runner, takes longer than Jest's 5 s (the first test also pays
// for rendering the app cold).
jest.setTimeout(30_000);

function SignedInPage() {
  const { signOut } = useSession();
  return <><Text>La conversation</Text><Control label="Se déconnecter" onPress={signOut} /></>;
}

function setUp() {
  const web = fakeWebApp();
  /** What the device forgets once the session ends (the Tailored Documents downloaded, #695). */
  const forgetOnDevice = jest.fn(async () => {});
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), fetch: web.fetch });
  /** The address the system last opened the app with, as Expo Linking's useLinkingURL gives it. */
  const opened = { current: null as string | null, listeners: new Set<() => void>() };
  const subscribe = (listener: () => void) => (opened.listeners.add(listener), () => void opened.listeners.delete(listener));
  function App() {
    const link = useSyncExternalStore(subscribe, () => opened.current);
    return (
      <SessionGate session={session} link={link} forgetOnDevice={forgetOnDevice}>
        <SignedInPage />
      </SessionGate>
    );
  }
  /** The app started, opened with `link` if any (a cold start). */
  const render = (link: string | null = null) => ((opened.current = link), renderInApp(<App />));
  /** The system opens the running app with `link`, as a universal link or an App Link does. */
  const openWith = (link: string) => act(async () => ((opened.current = link), opened.listeners.forEach((listener) => listener())));
  return { web, session, render, openWith, forgetOnDevice };
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

  it("shows the second step as a step to take, from which one can sign out", async () => {
    const { web, session, render } = setUp();
    web.withSecondStep(EMAIL);
    await session.askLink(EMAIL);

    await render(web.linkFor(EMAIL));

    expect(await screen.findByText("Vérification en deux étapes")).toBeOnTheScreen();
    expect(screen.getByText("Votre compte demande une deuxième étape pour terminer la connexion.")).toBeOnTheScreen();
    expect(screen.queryByText("La conversation")).toBeNull();
    await userEvent.setup().press(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
    expect(web.sessionCount()).toBe(0);
  });

  it("signs out: the session revoked, back to sign-in", async () => {
    const { web, session, render } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));

    await userEvent.setup().press(await screen.findByRole("button", { name: "Se déconnecter" }));

    expect(await screen.findByLabelText("Votre adresse e-mail")).toBeOnTheScreen();
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

  it("forgets what the device kept for the session when signing out", async () => {
    const { web, session, render, forgetOnDevice } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));
    await screen.findByText("La conversation");
    // The sign-in started afresh, forgetting once already (#695): from here on, the sign-out's.
    forgetOnDevice.mockClear();

    await userEvent.setup().press(screen.getByRole("button", { name: "Se déconnecter" }));

    await screen.findByLabelText("Votre adresse e-mail");
    expect(forgetOnDevice).toHaveBeenCalled();
  });

  it("forgets what the device kept for the session once it is revoked on the web", async () => {
    const { web, session, render, forgetOnDevice } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));
    await screen.findByText("La conversation");

    web.revokeAll(EMAIL);
    await backToForeground();

    await screen.findByLabelText("Votre adresse e-mail");
    expect(forgetOnDevice).toHaveBeenCalled();
  });

  it("starts a sign-in afresh: what the device kept before it is forgotten first (#695)", async () => {
    const { web, session, render, forgetOnDevice } = setUp();
    await session.askLink(EMAIL);
    await render(web.linkFor(EMAIL));
    await screen.findByText("La conversation");
    expect(forgetOnDevice).toHaveBeenCalled();
  });

  it("keeps what the device kept while the web app cannot be asked: the session may still be valid (#695)", async () => {
    const { web, session, render, forgetOnDevice } = setUp();
    await session.askLink(EMAIL);
    await session.openLink(web.linkFor(EMAIL));
    web.setOffline(true);
    await render();
    await screen.findByLabelText("Votre adresse e-mail");
    expect(forgetOnDevice).not.toHaveBeenCalled();
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
