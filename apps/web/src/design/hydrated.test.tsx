// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSettings } from "@/components/AccountSettings";
import { OfferBox } from "@/components/OfferBox";
import { SignInForm } from "@/components/SignInForm";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Button } from "./Button";
import { ConfirmDialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { renderInFrench } from "./testing";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/auth/client", () => ({ authClient: { signIn: { magicLink: vi.fn(), emailOtp: vi.fn(), social: vi.fn() } } }));

/** The HTML the server sends: what a person (or a test) can use before the page's scripts have run. */
function serverHtml(ui: ReactNode): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<I18nProvider locale="fr">{ui}</I18nProvider>);
  return container;
}

const drawer = (
  <Drawer trigger={<Button>Ouvrir la fiche</Button>} title="Perplexity">
    <p>Clé</p>
  </Drawer>
);
const confirm = (
  <ConfirmDialog trigger={<Button>Supprimer</Button>} title="Supprimer ?" confirmLabel="Supprimer" onConfirm={() => {}}>
    <p>Définitivement.</p>
  </ConfirmDialog>
);

// A control used before the page is hydrated does nothing: no handler is attached yet, and the choice or the click is
// lost (#446: the Interface Language picked too early stayed French; a Drawer's trigger clicked too early never opened).
// So each one is disabled until it can act, and Playwright, like a person, waits for it to be enabled.
describe("controls that only act once the page is hydrated", () => {
  it("the Interface Language is disabled in the server's HTML, then enabled", () => {
    expect(serverHtml(<AccountSettings interfaceLanguage="fr" />).querySelector("select")!.disabled).toBe(true);
    renderInFrench(<AccountSettings interfaceLanguage="fr" />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
  });

  it("a Drawer's trigger is disabled in the server's HTML, then enabled", () => {
    expect(serverHtml(drawer).querySelector("button")!.disabled).toBe(true);
    renderInFrench(drawer);
    expect((screen.getByRole("button", { name: "Ouvrir la fiche" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a ConfirmDialog's trigger is disabled in the server's HTML, then enabled", () => {
    expect(serverHtml(confirm).querySelector("button")!.disabled).toBe(true);
    renderInFrench(confirm);
    expect((screen.getByRole("button", { name: "Supprimer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  // Submitted before, the form was the browser's own: a GET to /connexion?email=…, the address in the URL and no email
  // sent (e2e/job-digest.spec.ts #300 hung on a sign-in link never asked for, #816). A provider's button did nothing.
  it("the sign-in page's « Recevoir mon lien de connexion » and each Sign-in Provider's button are disabled in the server's HTML, then enabled", () => {
    const form = <SignInForm providers={[{ id: "google", displayName: "Google" }]} callbackURL="/compte" errorURL="/connexion" />;
    const buttons = [...serverHtml(form).querySelectorAll("button")];
    expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([
      ["Continuer avec Google", true],
      ["Recevoir mon lien de connexion", true],
    ]);
    renderInFrench(form);
    expect((screen.getByRole("button", { name: "Continuer avec Google" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Recevoir mon lien de connexion" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the Offer box's « Suivre », « Écarter » and « Revenir sur ce choix » are disabled in the server's HTML, then enabled (#816)", () => {
    const line = (id: string, state: "to_handle" | "dismissed") => ({
      id,
      jobOffer: { id: `offer-${id}`, title: `Offre ${id}`, employer: null, location: null, url: null, postedAt: null, expiredAt: null, contractType: null },
      profile: { id: "p1", name: "DAF" },
      scoredWith: { id: "p1", name: "DAF" },
      matchScore: 70,
      firstArrivalAt: "2026-11-05T08:00:00.000Z",
      arrivalDay: "2026-11-05",
      sources: [{ source: "job_search" as const, at: "2026-11-05T08:00:00.000Z" }],
      state,
      applicationId: null,
      followedAt: null,
      dismissalReason: null,
      dismissedAt: state === "dismissed" ? "2026-11-05T09:00:00.000Z" : null,
    });
    const box = <OfferBox box={{ today: "2026-11-05", toHandle: 1, entries: [line("a", "to_handle"), line("b", "dismissed")] }} />;
    const decisions = ["Suivre", "Écarter", "Revenir sur ce choix"];
    const decisionButtons = (root: ParentNode) => [...root.querySelectorAll("button")].filter((button) => decisions.includes(button.textContent ?? ""));

    expect(decisionButtons(serverHtml(box)).map((button) => [button.textContent, button.disabled])).toEqual([
      ["Suivre", true],
      ["Écarter", true],
      ["Revenir sur ce choix", true],
    ]);
    renderInFrench(box);
    expect(decisionButtons(document.body).map((button) => [button.textContent, button.disabled])).toEqual([
      ["Suivre", false],
      ["Écarter", false],
      ["Revenir sur ce choix", false],
    ]);
  });

  it("a trigger disabled by its owner stays disabled once hydrated", () => {
    renderInFrench(
      <Drawer trigger={<Button disabled>Ouvrir la fiche</Button>} title="Perplexity">
        <p>Clé</p>
      </Drawer>,
    );
    expect((screen.getByRole("button", { name: "Ouvrir la fiche" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
