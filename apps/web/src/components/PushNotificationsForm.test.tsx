// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { PUSH_EVENT_IDS, type PushEvent } from "@/push-notifications/catalog";
import { PushNotificationsForm } from "./PushNotificationsForm";

const allOn = Object.fromEntries(PUSH_EVENT_IDS.map((event) => [event, true])) as Record<PushEvent, boolean>;
const CANDIDATE_EVENTS: PushEvent[] = ["job_search_results", "job_digest", "appointment_reminder", "coach_review", "coaching_session_changed", "follow_up_due"];

describe("PushNotificationsForm — the app's notifications in Mon compte › Rappels (#698)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has one switch per event, each on until switched off, and says how many devices are registered", () => {
    renderInFrench(<PushNotificationsForm events={CANDIDATE_EVENTS} settings={{ ...allOn, job_digest: false }} devices={0} />);

    const section = screen.getByRole("region", { name: "Notifications de l'app" });
    const switches = within(section).getAllByRole("switch");
    expect(switches).toHaveLength(6);
    expect(within(section).getByRole("switch", { name: "Nouveaux résultats d'une recherche d'offres" }).getAttribute("aria-checked")).toBe("true");
    expect(within(section).getByRole("switch", { name: "Nouveau Job Digest" }).getAttribute("aria-checked")).toBe("false");
    expect(within(section).getByText(/Aucun appareil enregistré/)).toBeTruthy();
    expect(within(section).queryByRole("switch", { name: "Accès donné par un candidat" })).toBeNull();
  });

  it("shows a Human Coach their own events too, under their heading", () => {
    renderInFrench(<PushNotificationsForm events={[...CANDIDATE_EVENTS, "coach_access_granted", "coaching_session_paid", "coaching_session_changed_by_candidate"]} settings={allOn} devices={2} />);
    expect(screen.getByRole("group", { name: "Votre espace coach" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Accès donné par un candidat" })).toBeTruthy();
    expect(screen.getByText("Notifications envoyées à 2 appareils.")).toBeTruthy();
  });

  it("saves a switch as soon as it changes", async () => {
    const fetch = vi.fn(async () => Response.json({ event: "follow_up_due", enabled: false }));
    vi.stubGlobal("fetch", fetch);
    renderInFrench(<PushNotificationsForm events={CANDIDATE_EVENTS} settings={allOn} devices={1} />);

    await userEvent.click(screen.getByRole("switch", { name: "Relance à faire" }));

    expect(fetch).toHaveBeenCalledWith("/api/account/push-notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "follow_up_due", enabled: false }) });
    expect(screen.getByRole("switch", { name: "Relance à faire" }).getAttribute("aria-checked")).toBe("false");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Choix enregistré."));
  });

  it("puts a switch back when its change could not be saved, and says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    renderInFrench(<PushNotificationsForm events={CANDIDATE_EVENTS} settings={allOn} devices={1} />);

    await userEvent.click(screen.getByRole("switch", { name: "Relance à faire" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Votre choix n'a pas pu être enregistré. Réessayez."));
    expect(screen.getByRole("switch", { name: "Relance à faire" }).getAttribute("aria-checked")).toBe("true");
  });
});
