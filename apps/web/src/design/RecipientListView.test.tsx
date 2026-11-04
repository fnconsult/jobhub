// @vitest-environment jsdom
import { recipientList } from "@jobhub/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecipientListView } from "./RecipientListView";
import { renderInFrench } from "./testing";

const ON = new Set(["anthropic", "mistral", "perplexity", "brevo-api", "stripe"]);
const recipients = recipientList((tool) => ON.has(tool.id));

describe("RecipientListView — « Destinataires des données » on Légal (ADR-0064, #338)", () => {
  it("is Légal's page, marked in its left column, with the day it last changed and the way to « IA dans Jobbbox »", () => {
    renderInFrench(<RecipientListView recipients={recipients} changedOn="2026-11-04" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Destinataires des données");
    const texts = screen.getByRole("navigation", { name: "Textes légaux" });
    expect(within(texts).getByRole("link", { name: "Destinataires des données" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Dernière modification le 4 novembre 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "IA dans Jobbbox, dans la politique de confidentialité" }).getAttribute("href")).toBe("/legal/confidentialite#ia");
    // GDPR art. 13(1)(f): how to get a copy of a transfer's safeguards.
    expect(screen.getByText(/^Pour obtenir une copie des garanties d'un transfert hors UE/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nous contacter" }).getAttribute("href")).toBe("/aide/decouvrir/faq-contact-us");
  });

  it("names each recipient, Hostinger first, with what it is for, what it receives, its entity, its place and its safeguard", () => {
    renderInFrench(<RecipientListView recipients={recipients} changedOn="2026-11-04" />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.firstChild?.textContent)).toEqual(["Hostinger", "Claude (Anthropic)", "Mistral AI", "Perplexity", "Stripe", "Brevo"]);
    const claude = screen.getByRole("region", { name: /Claude \(Anthropic\)/ });
    expect(within(claude).getByText("Hors UE")).toBeTruthy();
    expect(within(claude).getByText(/^Vos textes \(CV, candidatures, messages au coach\), sans votre nom.*pseudonymisées\.$/)).toBeTruthy();
    expect(within(claude).getByText("Anthropic Ireland, Limited")).toBeTruthy();
    expect(within(claude).getByText("Clauses contractuelles types de la Commission européenne.")).toBeTruthy();
    const mistral = screen.getByRole("region", { name: /Mistral AI/ });
    expect(within(mistral).getByText("Dans l'UE")).toBeTruthy();
    expect(within(mistral).getByText("Aucun transfert hors UE.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: /Perplexity/ })).getByText(/^Des requêtes seulement/)).toBeTruthy();
  });

  it("shows a recipient whose residency was not established as counted outside the EU", () => {
    renderInFrench(<RecipientListView recipients={recipients} changedOn={null} />);
    expect(within(screen.getByRole("region", { name: /Brevo/ })).getByText("Compté hors UE")).toBeTruthy();
    expect(screen.queryByText(/Dernière modification/)).toBeNull();
  });
});
