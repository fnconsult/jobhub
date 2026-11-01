// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it, vi } from "vitest";
import type { AgendaItem } from "@/agenda";
import { calendarPeriod } from "@/agenda/calendar";
import { renderInFrench } from "@/design/testing";
import { AgendaList, AgendaMonth, AgendaWeek, formatsFor } from "./AgendaViews";

vi.mock("next/navigation", () => ({ usePathname: () => "/agenda", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const NOW = new Date("2026-11-02T08:00:00Z");
const TODAY = "2026-11-02";
const t = createI18n("fr").t;
const formats = formatsFor("fr", NOW);
const INTERVIEW: AgendaItem = {
  kind: "interview",
  id: "i1",
  applicationId: "a1",
  jobTitle: "DAF H/F",
  scheduledAt: new Date("2026-11-04T09:00:00Z"),
  durationMinutes: null,
  format: null,
  place: "",
  reschedules: [],
};
const DAYS = [{ day: "2026-11-04", items: [INTERVIEW] }];
const byDay = new Map(DAYS.map((day) => [day.day, day.items]));

/** The ids given to more than one element of the document. */
function duplicateIds(): string[] {
  const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

/**
 * Under « Conversation au centre » (#606, ADR-0070) the list stays on the Agenda's card while the week or the month
 * opens in the Work Pane: two views on one page. Each names itself, and no id is given twice (axe's duplicate-id-aria).
 */
describe("the Agenda's list and its week or month on one page (#606)", () => {
  it("the list and the week: no id twice, and the week is named by its own title", () => {
    const period = calendarPeriod("semaine", TODAY);
    renderInFrench(
      <>
        <main>
          <AgendaList days={DAYS} past={false} withdrawable={new Set()} formats={formats} t={t} />
        </main>
        <aside>
          <AgendaWeek period={period} byDay={byDay} today={TODAY} withdrawable={new Set()} formats={formats} t={t} />
        </aside>
      </>,
    );

    expect(duplicateIds()).toEqual([]);
    expect(screen.getByRole("region", { name: t("agenda.upcomingTitle") })).toBeTruthy();
    expect(screen.getByRole("region", { name: t("agenda.weekTitle", { range: formats.range(period.first, period.last) }) })).toBeTruthy();
  });

  it("the list and the month: no id twice, and the month and its table are named by the month", () => {
    const period = calendarPeriod("mois", TODAY);
    const month = formats.month(period.first);
    renderInFrench(
      <>
        <main>
          <AgendaList days={DAYS} past={false} withdrawable={new Set()} formats={formats} t={t} />
        </main>
        <aside>
          <AgendaMonth period={period} byDay={byDay} selected="2026-11-04" today={TODAY} withdrawable={new Set()} formats={formats} t={t} />
        </aside>
      </>,
    );

    expect(duplicateIds()).toEqual([]);
    expect(screen.getByRole("region", { name: month })).toBeTruthy();
    expect(screen.getByRole("table", { name: month })).toBeTruthy();
  });
});
