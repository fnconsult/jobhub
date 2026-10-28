// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs";
import { renderInFrench } from "./testing";

const tabs = [
  { value: "web", label: "Recherche web", content: <p>Perplexity est actif.</p> },
  { value: "ai", label: "IA", content: <p>Mistral sert les tâches.</p> },
  { value: "email", label: "E-mail", content: <p>Brevo envoie les e-mails.</p> },
];

describe("Tabs (#462)", () => {
  it("names its list, takes one Tab stop on the active tab, then goes into its panel", async () => {
    const user = userEvent.setup();
    renderInFrench(<Tabs label="Paramètres" tabs={tabs} />);
    expect(screen.getByRole("tablist", { name: "Paramètres" })).toBeTruthy();
    await user.tab();
    const web = screen.getByRole("tab", { name: "Recherche web" });
    expect(document.activeElement).toBe(web);
    expect(web.getAttribute("aria-selected")).toBe("true");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("tabpanel", { name: "Recherche web" }));
  });

  it("moves between tabs with the arrow keys, wrapping round, and shows the tab focused", async () => {
    const user = userEvent.setup();
    renderInFrench(<Tabs label="Paramètres" tabs={tabs} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "IA" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("Mistral sert les tâches.");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Recherche web" }));
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "E-mail" }).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Recherche web" }));
    await user.keyboard("{End}");
    expect(screen.getByRole("tabpanel").textContent).toBe("Brevo envoie les e-mails.");
  });

  it("follows the value it is given, and says which tab is chosen", async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];
    renderInFrench(<Tabs label="Paramètres" tabs={tabs} value="ai" onValueChange={(value) => chosen.push(value)} />);
    expect(screen.getByRole("tab", { name: "IA" }).getAttribute("aria-selected")).toBe("true");
    await user.click(screen.getByRole("tab", { name: "E-mail" }));
    expect(new Set(chosen)).toEqual(new Set(["email"]));
  });
});
