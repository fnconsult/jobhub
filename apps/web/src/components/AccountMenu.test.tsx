// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AccountMenu, type SidebarCandidate } from "./AccountMenu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const PREMIUM = { name: { fr: "Premium", en: "Premium" }, endsAt: null };
const MIMI: SidebarCandidate = { givenName: "Marie", familyName: "Dupont", preferredName: "Mimi", email: "marie.dupont@example.fr", plan: PREMIUM };
const LINKS = { account: { href: "/compte", current: false }, subscription: { href: "/abonnement", current: false } };

function renderMenu(candidate: SidebarCandidate, links = LINKS) {
  renderInFrench(<AccountMenu {...links} candidate={candidate} onNavigate={() => {}} />);
  return screen.getByRole("button", { name: /^Mon compte/ });
}

async function openMenu(button: HTMLElement) {
  button.focus();
  await userEvent.setup().keyboard("{Enter}");
  return screen.findByRole("menu");
}

describe("« Mon compte » in the Sidebar's foot: the Candidate's name and Plan (#923)", () => {
  it("shows the Preferred Name, then the Plan, beside the initials of the Given Name and Family Name", () => {
    const button = renderMenu(MIMI);

    expect(button.getAttribute("aria-label")).toBe("Mon compte, Mimi, Premium");
    expect(button.querySelector(".account-name")?.textContent).toBe("Mimi");
    expect(button.querySelector(".account-plan")?.textContent).toBe("Premium");
    const initials = button.querySelector(".account-initials");
    expect(initials?.textContent).toBe("MD");
    expect(initials?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the Given Name without a Preferred Name", () => {
    const button = renderMenu({ ...MIMI, preferredName: null });

    expect(button.getAttribute("aria-label")).toBe("Mon compte, Marie, Premium");
    expect(button.querySelector(".account-name")?.textContent).toBe("Marie");
    expect(button.querySelector(".account-initials")?.textContent).toBe("MD");
  });

  it("shows « Mon compte » and the account's icon without a name", () => {
    const button = renderMenu({ ...MIMI, givenName: null, familyName: null, preferredName: null });

    expect(button.getAttribute("aria-label")).toBe("Mon compte, Premium");
    expect(button.querySelector(".account-name")?.textContent).toBe("Mon compte");
    expect(button.querySelector(".account-initials")).toBeNull();
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it.each([
    { state: "Free", plan: { name: { fr: "Gratuit", en: "Free" }, endsAt: null }, shown: "Gratuit", label: "Mon compte, Mimi, Gratuit" },
    { state: "Standard", plan: { name: { fr: "Standard", en: "Standard" }, endsAt: null }, shown: "Standard", label: "Mon compte, Mimi, Standard" },
    { state: "Premium", plan: PREMIUM, shown: "Premium", label: "Mon compte, Mimi, Premium" },
    {
      state: "Premium, its cancellation scheduled",
      plan: { name: { fr: "Premium", en: "Premium" }, endsAt: "2026-11-30T10:00:00.000Z" },
      shown: "Premium jusqu'au 30 nov.",
      label: "Mon compte, Mimi, Premium jusqu'au 30 nov.",
    },
  ])("shows the Plan: $state", ({ plan, shown, label }) => {
    const button = renderMenu({ ...MIMI, plan });

    expect(button.getAttribute("aria-label")).toBe(label);
    expect(button.querySelector(".account-plan")?.textContent).toBe(shown);
  });

  it("says when the Plan ends apart, so it can stand out", () => {
    const button = renderMenu({ ...MIMI, plan: { ...PREMIUM, endsAt: "2026-11-30T10:00:00.000Z" } });

    expect(button.querySelector(".account-plan-ending")?.textContent).toBe("jusqu'au 30 nov.");
  });

  it("shows the name alone when the Plan could not be read", () => {
    const button = renderMenu({ ...MIMI, plan: null });

    expect(button.getAttribute("aria-label")).toBe("Mon compte, Mimi");
    expect(button.querySelector(".account-plan")).toBeNull();
  });
});

describe("Mon compte's menu (#923)", () => {
  it("is headed by « Prénom Nom » and the email, then Aide et légal, Mon compte, Mon abonnement with the Plan, Se déconnecter", async () => {
    const menu = await openMenu(renderMenu(MIMI));

    const head = menu.querySelector(".account-menu-head");
    expect(head?.textContent).toContain("Marie Dupont");
    expect(head?.textContent).toContain("marie.dupont@example.fr");
    expect(within(head as HTMLElement).queryByRole("menuitem")).toBeNull();
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Aide", "Légal", "Nouveautés", "Mon compte", "Mon abonnementPremium", "Se déconnecter"]);
    const subscription = within(menu).getByRole("menuitem", { name: /^Mon abonnement/ });
    expect(subscription.getAttribute("href")).toBe("/abonnement");
    expect(subscription.querySelector(".account-menu-aside")?.textContent).toBe("Premium");
  });

  it("is headed by the email alone without a Given Name or Family Name", async () => {
    const menu = await openMenu(renderMenu({ ...MIMI, givenName: null, familyName: null, preferredName: null }));

    expect(menu.querySelector(".account-menu-head")?.textContent).toBe("marie.dupont@example.fr");
  });

  it("marks Mon abonnement current on its page, and Mon compte on Mon compte's", async () => {
    const onSubscription = { account: { href: "/compte", current: true }, subscription: { href: "/abonnement", current: true } };
    const menu = await openMenu(renderMenu(MIMI, onSubscription));

    expect(within(menu).getByRole("menuitem", { name: /^Mon abonnement/ }).getAttribute("aria-current")).toBe("page");
    expect(within(menu).getByRole("menuitem", { name: "Mon compte" }).getAttribute("aria-current")).toBeNull();
  });
});
