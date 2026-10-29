// @vitest-environment jsdom
import { nouveautes, type ReleaseNote } from "@jobhub/help";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ReleaseNotesView } from "./ReleaseNotesView";
import { renderInFrench } from "./testing";

const note = (version: string, date: string, title: string, tags: ReleaseNote["tags"], extra: Partial<ReleaseNote> = {}): ReleaseNote => ({
  version,
  locale: "fr",
  date,
  title,
  tags,
  image: null,
  announce: false,
  intro: "Ce qui change pour vous.",
  changes: [],
  ...extra,
});

const notes = [
  note("0.1.0", "2026-11-02", "Jobbbox ouvre ses portes", ["candidature"]),
  note("0.3.0", "2026-12-07", "Entreprises cibles sur votre profil", ["candidature", "coach-ia"], {
    image: { file: "0.3.0-entreprises.png", alt: "La liste des entreprises cibles" },
    changes: [
      { kind: "new", text: "Les **entreprises cibles** sur la page du profil." },
      { kind: "improved", text: "Le Match Score explique ce qui manque." },
      { kind: "fixed", text: "Le Job Digest ne répète plus une offre." },
    ],
  }),
  note("0.2.0", "2026-11-20", "L'extension lit les offres", ["extension"]),
];

const titles = (scope: HTMLElement) => within(scope).queryAllByRole("article").map((release) => within(release).getByRole("heading").textContent);

describe("ReleaseNotesView — the Nouveautés page's Release Notes (#470)", () => {
  it("lists the Release Notes newest first, each with its date, Version, tags, text, image and change lines", () => {
    renderInFrench(<ReleaseNotesView {...nouveautes(notes, { version: "0.3.0", beta: false })} />);

    const published = screen.getByRole("region", { name: "Versions publiées" });
    expect(titles(published)).toEqual(["Entreprises cibles sur votre profil", "L'extension lit les offres", "Jobbbox ouvre ses portes"]);
    const latest = within(published).getAllByRole("article")[0]!;
    expect(within(latest).getByText("7 décembre 2026").getAttribute("datetime")).toBe("2026-12-07");
    expect(within(latest).getByText("Version 0.3.0")).toBeTruthy();
    expect(within(latest).getByText("Coach IA")).toBeTruthy();
    expect(within(latest).getByRole("img", { name: "La liste des entreprises cibles" }).getAttribute("src")).toBe("/nouveautes/0.3.0-entreprises.png");
    const lines = within(latest).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["NouveauLes entreprises cibles sur la page du profil.", "AmélioréLe Match Score explique ce qui manque.", "CorrigéLe Job Digest ne répète plus une offre."]);
    expect(screen.queryByRole("region", { name: "Version bêta, pas encore publiée" })).toBeNull();
  });

  it("on the Beta, shows the next Version under « Version bêta, pas encore publiée », apart from the published ones", () => {
    renderInFrench(<ReleaseNotesView {...nouveautes(notes, { version: "0.3.0", beta: true })} />);

    const beta = screen.getByRole("region", { name: "Version bêta, pas encore publiée" });
    expect(within(beta).getByRole("heading", { level: 3 }).textContent).toBe("Entreprises cibles sur votre profil");
    expect(titles(screen.getByRole("region", { name: "Versions publiées" }))).toEqual(["L'extension lit les offres", "Jobbbox ouvre ses portes"]);
  });

  it("filters by tag with its pills, « Tout » showing every Version again", async () => {
    const user = userEvent.setup();
    renderInFrench(<ReleaseNotesView {...nouveautes(notes, { version: "0.3.0", beta: false })} />);
    const filters = screen.getByRole("group", { name: "Filtrer par thème" });
    expect(within(filters).getAllByRole("button").map((button) => button.textContent)).toEqual(["Tout", "Candidature", "Extension", "Coach IA"]);
    expect(within(filters).getByRole("button", { name: "Tout" }).getAttribute("aria-pressed")).toBe("true");

    await user.click(within(filters).getByRole("button", { name: "Extension" }));
    expect(within(filters).getByRole("button", { name: "Extension" }).getAttribute("aria-pressed")).toBe("true");
    expect(titles(screen.getByRole("region", { name: "Versions publiées" }))).toEqual(["L'extension lit les offres"]);

    await user.click(within(filters).getByRole("button", { name: "Tout" }));
    expect(titles(screen.getByRole("region", { name: "Versions publiées" }))).toHaveLength(3);
  });

  it("shows that nothing is published until the first Release Note", () => {
    renderInFrench(<ReleaseNotesView {...nouveautes([], { version: "0.1.0", beta: true })} />);
    expect(screen.getByRole("heading", { name: "Rien n'est encore publié" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Filtrer par thème" })).toBeNull();
  });

  it("speaks the page's language", () => {
    const english = notes.map((entry) => ({ ...entry, locale: "en" as const }));
    render(
      <I18nProvider locale="en">
        <ReleaseNotesView {...nouveautes(english, { version: "0.3.0", beta: true })} />
      </I18nProvider>,
    );
    expect(screen.getByRole("region", { name: "Beta version, not published yet" })).toBeTruthy();
    expect(screen.getByText("December 7, 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "AI Coach" })).toBeTruthy();
  });
});
