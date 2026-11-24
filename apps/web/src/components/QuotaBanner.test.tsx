// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import type { QuotaBannerLine } from "@/quota-banner";
import { QuotaBanner } from "./QuotaBanner";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/activite/actions" }));

const MISTRAL: QuotaBannerLine = {
  toolId: "mistral",
  toolName: "Mistral AI",
  state: "quota_exhausted",
  since: new Date("2026-11-24T09:05:00Z"),
  configHref: "/admin/parametres?tab=ia&fournisseur=mistral",
  billingUrl: "https://console.mistral.ai/billing",
};
const TAVILY: QuotaBannerLine = { ...MISTRAL, toolId: "tavily", toolName: "Tavily", state: "rate_limited", configHref: null, billingUrl: "https://app.tavily.com/billing" };

describe("the « Quota atteint » banner (#1115)", () => {
  it("is not drawn while no Tool has reached its quota", () => {
    const { container } = renderInFrench(<QuotaBanner lines={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("is a warning status naming each Tool, its state and since when, Paris time", () => {
    renderInFrench(<QuotaBanner lines={[MISTRAL, TAVILY]} />);
    const banner = screen.getByRole("status");

    expect(banner.dataset.tone).toBe("warn");
    expect(banner.dataset.alert).toBe("quota");
    expect(within(banner).getByText("Quota atteint")).toBeTruthy();
    const lines = within(banner).getAllByRole("listitem");
    expect(lines.map((line) => line.querySelector("p")?.textContent)).toEqual([
      "Mistral AI : quota épuisé depuis le 24 nov. 2026, 10:05.",
      "Tavily : limite atteinte depuis le 24 nov. 2026, 10:05.",
    ]);
  });

  it("leads to the Tool's configuration in the Back Office, and to its provider's billing page in a new tab, through the Exit Page", () => {
    renderInFrench(<QuotaBanner lines={[MISTRAL]} />);

    expect(screen.getByRole("link", { name: "Configurer Mistral AI" }).getAttribute("href")).toBe("/admin/parametres?tab=ia&fournisseur=mistral");
    const billing = screen.getByRole("link", { name: "Facturation de Mistral AI (nouvel onglet)" });
    expect(billing.getAttribute("href")).toBe(`/admin/sortie?url=${encodeURIComponent("https://console.mistral.ai/billing")}`);
    expect(billing.getAttribute("target")).toBe("_blank");
  });

  it("gives the billing page alone to a reader who may configure neither", () => {
    renderInFrench(<QuotaBanner lines={[TAVILY]} />);

    expect(screen.queryByRole("link", { name: /Configurer/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Facturation de Tavily (nouvel onglet)" })).toBeTruthy();
  });

  it("speaks English", () => {
    render(
      <I18nProvider locale="en">
        <QuotaBanner lines={[MISTRAL]} />
      </I18nProvider>,
    );
    const banner = screen.getByRole("status");

    expect(within(banner).getByText("Quota reached")).toBeTruthy();
    expect(within(banner).getByRole("listitem").querySelector("p")?.textContent).toBe("Mistral AI: quota used up since 24 Nov 2026, 10:05.");
    expect(screen.getByRole("link", { name: "Configure Mistral AI" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mistral AI billing (new tab)" })).toBeTruthy();
  });
});
