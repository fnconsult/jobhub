// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Card, Stat, Stats } from "./Card";
import { EmptyState } from "./EmptyState";
import { Note } from "./Note";
import { PageHeader } from "./PageHeader";
import { Ring } from "./Ring";
import { renderInFrench } from "./testing";

describe("Note (#462)", () => {
  it("says its title then its text, its icon hidden, its tone in words for a danger", () => {
    renderInFrench(
      <Note tone="danger" title="Route refusée.">
        Cette tâche traite des données personnelles et ce modèle est hors UE.
      </Note>,
    );
    const note = screen.getByText("Route refusée.").closest("[data-tone]") as HTMLElement;
    expect(note.getAttribute("data-tone")).toBe("danger");
    expect(note.textContent).toBe("Route refusée.Cette tâche traite des données personnelles et ce modèle est hors UE.");
    expect(note.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("EmptyState (#462)", () => {
  it("has its title as a heading, its text, its actions and its help link", () => {
    renderInFrench(
      <EmptyState
        title="Aucune candidature pour l'instant"
        actions={<Button variant="primary">Chercher des offres</Button>}
        help={<a href="/aide/candidatures">Comment suivre une candidature ?</a>}
      >
        Enregistrez une offre trouvée par votre coach : elle apparaîtra ici.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "Aucune candidature pour l'instant" })).toBeTruthy();
    expect(screen.getByText("Enregistrez une offre trouvée par votre coach : elle apparaîtra ici.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chercher des offres" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Comment suivre une candidature ?" })).toBeTruthy();
  });
});

describe("Card and Stat (#462)", () => {
  it("a Card titles its content", () => {
    renderInFrench(<Card title="Dépense quotidienne">un graphique</Card>);
    expect(screen.getByRole("heading", { name: "Dépense quotidienne" })).toBeTruthy();
  });

  it("a Card can be an article named by its title (an Action Card, #467)", () => {
    renderInFrench(
      <Card as="article" headingId="relance-1" headingLevel={3} title="Relancer l'employeur pour « DAF »" actions={<span>Relance suggérée</span>}>
        Bonjour, je reviens vers vous…
      </Card>,
    );
    const article = screen.getByRole("article", { name: "Relancer l'employeur pour « DAF »" });
    expect(within(article).getByRole("heading", { level: 3 }).id).toBe("relance-1");
    expect(article.textContent).toContain("Relance suggérée");
  });

  it("a Stat gives its label, value, metadata, progress towards a threshold and trend", () => {
    renderInFrench(
      <Stats>
        <Stat label="Dépense recherche web" value="0,04 €" meta="2 % du seuil d'alerte (2,00 €)" progress={2} trend={{ direction: "up", tone: "danger", text: "+12 pts sur 7 jours" }} />
      </Stats>,
    );
    expect(screen.getByRole("term").textContent).toBe("Dépense recherche web");
    const bar = screen.getByRole("progressbar", { name: "Dépense recherche web" });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    const stat = bar.closest("[data-stat]") as HTMLElement;
    expect(within(stat).getByText("0,04 €")).toBeTruthy();
    expect(within(stat).getByText("2 % du seuil d'alerte (2,00 €)")).toBeTruthy();
    expect(within(stat).getByText("+12 pts sur 7 jours")).toBeTruthy();
  });

  it("keeps a progress over 100 or under 0 inside the bar", () => {
    renderInFrench(
      <Stats>
        <Stat label="Quota" value="130 %" progress={130} />
      </Stats>,
    );
    const bar = screen.getByRole("progressbar", { name: "Quota" });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.hasAttribute("data-reached")).toBe(true);
  });

  it("names its progress bar by `name` when its label is not plain words (an Explainable label)", () => {
    renderInFrench(
      <Stats>
        <Stat label={<button type="button">Coût moyen d'un run</button>} name="Coût moyen d'un run" value="0,12 €" progress={40} />
      </Stats>,
    );
    expect(screen.getByRole("progressbar", { name: "Coût moyen d'un run" }).hasAttribute("data-reached")).toBe(false);
  });
});

describe("PageHeader (#462)", () => {
  it("has the page's one level-1 heading, its eyebrow, subtitle and actions", () => {
    renderInFrench(<PageHeader eyebrow="Plateforme" title="Paramètres" subtitle="Ce que la plateforme utilise." actions={<Button>Ajouter</Button>} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Paramètres" });
    const header = heading.closest("header") as HTMLElement;
    expect(within(header).getByText("Plateforme")).toBeTruthy();
    expect(within(header).getByText("Ce que la plateforme utilise.")).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Ajouter" })).toBeTruthy();
  });

  it("takes a lower heading level on a page whose title is already its level-1 heading (the Design System page, #463)", () => {
    renderInFrench(<PageHeader title="Composants" headingLevel={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "Composants" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("Ring (#462)", () => {
  it("shows a Match Score as a number out of 100, read as such", () => {
    renderInFrench(<Ring label="Match Score" value={82} />);
    const ring = screen.getByRole("img", { name: "Match Score : 82 sur 100" });
    expect(ring.textContent).toBe("82");
  });

  it("rounds the score and keeps it between 0 and 100", () => {
    renderInFrench(<Ring label="ATS Score" value={104.4} />);
    expect(screen.getByRole("img", { name: "ATS Score : 100 sur 100" })).toBeTruthy();
  });

  it("drawn beside the score in words (a Job Offer card, #467), it is decoration only", () => {
    const { container } = renderInFrench(<Ring decorative value={92} />);
    expect(screen.queryByRole("img")).toBeNull();
    const ring = container.querySelector(".ds-ring") as HTMLElement;
    expect(ring.getAttribute("aria-hidden")).toBe("true");
    expect(ring.textContent).toBe("92");
  });
});
