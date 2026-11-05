// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { CoachProposalsDisplayChoice } from "./CoachProposalsDisplayChoice";

let answers: { status: number; body: unknown }[];
let sent: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  answers = [];
  sent = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
    const answer = answers.shift() ?? { status: 500, body: { error: "failed" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const chosen = () => screen.getAllByRole("radio").find((option) => option.getAttribute("aria-checked") === "true")?.textContent;

describe("« Propositions du coach » in Mon compte › Préférences (#717, ADR-0077)", () => {
  it("offers « Carte » and « Formulaire », « Carte » by default, saying what each shows first", () => {
    renderInFrench(<CoachProposalsDisplayChoice display="card" />);

    expect(screen.getByRole("radiogroup", { name: "Propositions du coach" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((option) => option.textContent)).toEqual(["Carte", "Formulaire"]);
    expect(chosen()).toBe("Carte");
    expect(screen.getByText(/« Appliquer » et « Modifier avant d'appliquer » restent sur chaque carte/)).toBeTruthy();
  });

  it("shows « Formulaire » when the Candidate chose it", () => {
    renderInFrench(<CoachProposalsDisplayChoice display="form" />);
    expect(chosen()).toBe("Formulaire");
  });

  it("saves the choice with the account as soon as it changes, and says so", async () => {
    answers.push({ status: 200, body: { display: "form" } });
    renderInFrench(<CoachProposalsDisplayChoice display="card" />);

    await userEvent.click(screen.getByRole("radio", { name: "Formulaire" }));

    expect(sent).toEqual([{ url: "/api/account/coach-proposals-display", method: "PUT", body: { display: "form" } }]);
    expect(chosen()).toBe("Formulaire");
    expect((await screen.findByRole("status")).textContent).toBe("Enregistré : le formulaire de chaque proposition s'ouvrira dans le volet.");
  });

  it("puts the choice back when it could not be saved, and says so", async () => {
    answers.push({ status: 500, body: { error: "failed" } });
    renderInFrench(<CoachProposalsDisplayChoice display="card" />);

    await userEvent.click(screen.getByRole("radio", { name: "Formulaire" }));

    expect((await screen.findByRole("alert")).textContent).toContain("n'a pas pu être enregistré");
    expect(chosen()).toBe("Carte");
  });

  it("speaks English", () => {
    render(
      <I18nProvider locale="en">
        <CoachProposalsDisplayChoice display="card" />
      </I18nProvider>,
    );
    expect(screen.getByRole("radiogroup", { name: "Coach proposals" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((option) => option.textContent)).toEqual(["Card", "Form"]);
  });
});
