// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import type { CreateAgentKeyState } from "./agent-keys-actions";

// Built at run time: no key's value is ever written in git, not even a fake one.
const VALUE = `jbx_agent_${"Zz9".repeat(14)}`;
const answered = vi.hoisted(() => ({ next: null as unknown, forms: [] as FormData[] }));
vi.mock("./agent-keys-actions", () => ({
  createAgentKey: async (_previous: CreateAgentKeyState, form: FormData) => {
    answered.forms.push(form);
    return answered.next;
  },
}));

const { AgentKeyCreateForm } = await import("./AgentKeyCreateForm");

describe("« Créer une clé » (#1139)", () => {
  afterEach(() => {
    answered.forms = [];
  });

  it("sends the name, the scope and the expiry, then shows the value once, in the page, never in the address", async () => {
    answered.next = { created: { name: "triage-beta", value: VALUE, expiresAt: "2027-02-24T09:00:00.000Z" } };
    renderInFrench(<AgentKeyCreateForm locale="fr" />);
    expect(screen.queryByDisplayValue(VALUE)).toBeNull();

    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "triage-beta" } });
    fireEvent.submit(screen.getByRole("button", { name: "Créer la clé" }).closest("form")!);

    expect(await screen.findByDisplayValue(VALUE)).toBeTruthy();
    expect(screen.getByText("Clé « triage-beta » créée")).toBeTruthy();
    expect(screen.getByText(/elle n'est montrée qu'une fois/)).toBeTruthy();
    expect(Object.fromEntries(answered.forms[0]!)).toEqual({ name: "triage-beta", scope: "signalements", days: "90" });
    expect(window.location.href).not.toContain(VALUE);
  });

  it("says what to fix: a name taken, or an expiry beyond 90 days", async () => {
    answered.next = { refused: "name_taken" };
    const { unmount } = renderInFrench(<AgentKeyCreateForm locale="fr" />);
    fireEvent.submit(screen.getByRole("button", { name: "Créer la clé" }).closest("form")!);
    expect(await screen.findByText("Une clé porte déjà ce nom.")).toBeTruthy();
    unmount();

    answered.next = { errors: [{ field: "days", code: "invalid" }] };
    renderInFrench(<AgentKeyCreateForm locale="fr" />);
    fireEvent.submit(screen.getByRole("button", { name: "Créer la clé" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("L'échéance va de 1 à 90 jours.")).toBeTruthy());
  });
});
