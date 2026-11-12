// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it, vi } from "vitest";
import type { AgendaItem } from "@/agenda";
import { renderInFrench } from "@/design/testing";
import { AgendaList, formatsFor } from "./AgendaViews";

vi.mock("next/navigation", () => ({ usePathname: () => "/agenda", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const NOW = new Date("2026-11-02T08:00:00Z");
const t = createI18n("fr").t;
/** A Coaching Session on 13 March 2030 at 11:00 in Paris, last moved through Cal.com. */
const SESSION: AgendaItem = {
  kind: "coachingSession",
  id: "s1",
  scheduledAt: new Date("2030-03-13T10:00:00Z"),
  coach: { id: "c1", name: "Camille Martin" },
  durationMinutes: 60,
  changedBy: "cal_com",
  reschedules: [],
};
const DAYS = [{ day: "2030-03-13", items: [SESSION] }];

describe("a Coaching Session on the Agenda behind « Espace coach v2 » (ADR-0106)", () => {
  it("off: « 11:00 » in Paris, as on main, with no Cal.com label", () => {
    const formats = formatsFor("fr", NOW);
    expect(formats.coachingTime(SESSION.scheduledAt)).toBe("11:00");
    renderInFrench(<AgendaList days={DAYS} past={false} withdrawable={new Set()} formats={formats} t={t} />);
    expect(document.querySelector(".agenda-item-time")?.textContent).toBe("11:00");
    expect(screen.queryByText(t("coachingBooking.viaCal"))).toBeNull();
    expect(screen.getByText(t("agendaChanges.cancelSession"))).toBeTruthy();
  });

  it("on: in the Candidate's zone, with Paris alongside, and the Cal.com label", () => {
    const formats = formatsFor("fr", NOW, { timeZone: "America/Montreal" });
    renderInFrench(<AgendaList days={DAYS} past={false} withdrawable={new Set()} formats={formats} t={t} />);
    const time = document.querySelector(".agenda-item-time")?.textContent ?? "";
    expect(time).toContain("America/Montreal");
    expect(time).toContain("Europe/Paris");
    expect(screen.getByText(t("coachingBooking.viaCal"))).toBeTruthy();
  });
});
