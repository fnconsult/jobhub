// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { screen, within } from "@testing-library/react";
import { auditComponentStylesheet } from "@jobhub/shared/design";
import type { Provenance } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachJobOfferCard } from "./CoachJobOfferCard";
import { ProvenanceLine } from "./ProvenanceLine";

// The Job Offer card an AI Coach reply answers a pasted link with (#267), drawn with the Design System alone. A
// regression (the product owner's screenshot « coach-card-suivie ») showed it with a thick accent edge on its left, an
// ad-hoc pill with a dot, a square outlined button and, under it, a boxed « hors UE » tag: none of them the Design
// System's. These tests keep them from coming back; its screenshot baselines are in e2e/coach-job-offer-card-screenshots.spec.ts.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const cardCss = () => stripComments(readFileSync("apps/web/src/components/CoachJobOfferCard.css", "utf8"));
const appCss = () => stripComments(readFileSync("apps/web/src/app/app.css", "utf8"));

const followed = { id: "7c1f5c55-0b4d-4f3b-9a51-3a4c4f6a2a10", title: "Manager Stratégie & Data", employer: "digiRocks", followed: true };

describe("the Job Offer card in the thread, on the Design System", () => {
  it("is a Card, its title in the card's head, its state a Pill, « Ouvrir l'offre » a small secondary Button", () => {
    renderInFrench(<CoachJobOfferCard jobOffer={followed} />);

    const card = screen.getByRole("article", { name: "Offre ajoutée" });
    expect(card.classList.contains("ds-card")).toBe(true);
    const heading = within(card).getByRole("heading", { level: 4, name: "Manager Stratégie & Data" });
    expect(card.querySelector(".ds-card__head")!.contains(heading)).toBe(true);
    expect(within(card).getByText("digiRocks").className).toBe("coach-job-offer-card__employer");
    const pill = within(card).getByText("Suivie");
    expect(pill.className).toBe("ds-pill");
    expect(pill.dataset.tone).toBe("success");
    const open = within(card).getByRole("link", { name: "Ouvrir l'offre" });
    expect(open.className).toBe("ds-button ds-button--secondary ds-button--sm");
    expect(open.getAttribute("href")).toBe(`/offres/${followed.id}`);
    expect(open.getAttribute("aria-describedby")).toBe(heading.id);
  });

  it("says « À traiter » in the accent Pill until the Candidate follows it, and leaves out an unknown employer", () => {
    renderInFrench(<CoachJobOfferCard jobOffer={{ ...followed, employer: undefined, followed: false }} />);

    const card = screen.getByRole("article", { name: "Offre ajoutée" });
    expect(within(card).getByText("À traiter").dataset.tone).toBe("accent");
    expect(card.querySelector(".coach-job-offer-card__employer")).toBeNull();
  });

  it("has no edge of its own and leaves the Card its background, border, radius and shadow", () => {
    const rule = /(?:^|\})\s*\.coach-job-offer-card\s*\{([^}]*)\}/.exec(cardCss())?.[1] ?? "";
    expect(rule).toMatch(/max-width:\s*min\(100%,\s*34rem\)/);
    expect(cardCss()).not.toMatch(/border-(left|right|top|bottom|inline|block)/);
    expect(rule).not.toMatch(/(?:^|;|\s)(background|border|border-radius|box-shadow)\s*:/);
  });

  it("takes every font size and colour from the tokens (the Design System components' audit)", () => {
    expect(auditComponentStylesheet(readFileSync("apps/web/src/components/CoachJobOfferCard.css", "utf8"))).toEqual([]);
  });

  it("leaves no style of the old card, nor its boxed « hors UE » tag, in the app's stylesheet", () => {
    expect(appCss()).not.toMatch(/\.job-offer-card\b/);
    expect(appCss()).not.toMatch(/\.provenance-chip\b/);
  });
});

describe("no component of the thread draws a coloured edge on its left (the regression's accent bar)", () => {
  // The thread's cards: the Job Offer card, the Coach proposals' Action Cards, the Coach Memory's and the help's.
  const sheets = readdirSync("apps/web/src/components")
    .filter((name) => /^Coach.*\.css$/.test(name))
    .map((name) => ({ name, css: stripComments(readFileSync(`apps/web/src/components/${name}`, "utf8")) }));

  it("finds the thread's stylesheets", () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["CoachJobOfferCard.css", "CoachProposalCard.css"]));
  });

  it.each(sheets)("$name sets no border-left", ({ css }) => {
    expect(css).not.toMatch(/border-left\s*:/);
  });
});

describe("the Provenance line's « hors UE » (#327)", () => {
  const provenance: Provenance = {
    v: 1,
    steps: [
      {
        kind: "ai",
        activity: "think_write",
        task: "coaching",
        provider: "anthropic",
        endpoint: "bedrock us-east-1",
        model: "anthropic.claude-opus-5",
        tokens: { input: 1500, output: 600 },
        ms: 6000,
        at: "2026-10-23T08:40:00.000Z",
        outcome: "ok",
        count: 1,
      },
    ],
    sites: [],
    startedAt: "2026-10-23T08:40:00.000Z",
    wallMs: 6400,
  };

  it("is a small neutral Pill of the Design System, at the metadata size, never the old boxed chip (ADR-0009, 2026-11-12)", () => {
    const { container } = renderInFrench(<ProvenanceLine provenance={provenance} at="2026-10-23T08:40:06.400Z" />);

    const tag = within(container).getByText("hors UE");
    expect(tag.className).toBe("ds-pill");
    expect(tag.dataset.size).toBe("sm");
    expect(tag.dataset.tone).toBe("neutral");
    expect(container.querySelector(".provenance-chip, .provenance-tag")).toBeNull();
  });

  it("says « consentement IA UE » the same way for a reply on the EU AI Consent route", () => {
    const consent: Provenance = { ...provenance, steps: [{ ...provenance.steps[0]!, provider: "mistral", endpoint: "api.eu.mistral.ai", model: "mistral-large-latest", euAiConsent: true } as Provenance["steps"][number]] };
    const { container } = renderInFrench(<ProvenanceLine provenance={consent} at="2026-10-23T08:40:06.400Z" />);

    const tag = within(container).getByText("consentement IA UE");
    expect(tag.className).toBe("ds-pill");
    expect(tag.dataset.size).toBe("sm");
  });
});
