import { useQuery } from "@tanstack/react-query";
import { act, screen, userEvent } from "@testing-library/react-native";
import { useSyncExternalStore } from "react";
import { AppState, Text } from "react-native";
import { renderInApp } from "../testing";
import { Control } from "../ui/Control";
import { createAppSession } from "./app-session";
import { SessionGate, useSession } from "./SessionGate";
import { fakeWebApp, memoryStorage, memoryWebViewCookies, TEST_BASE_URL } from "./testing";

const EMAIL = "marie.dupont@example.fr";
const OTHER_EMAIL = "paul.martin@example.fr";

/** How many times the signed-in page has read the web app; a read kept for good, as the legal steps' is. */
let reads = 0;

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

function setUp() {
  reads = 0;
  const web = fakeWebApp();
  const session = createAppSession({ baseURL: TEST_BASE_URL, storage: memoryStorage(), webViewCookies: memoryWebViewCookies(), fetch: web.fetch });
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
});
