// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createI18n } from "@jobhub/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachingSessionAgendaItem } from "@/agenda";
import { renderInFrench } from "@/design/testing";
import { AgendaList, formatsFor, type Formats } from "./AgendaViews";

// #1026: on the Agenda, a Coaching Session that has ended (`coachingSessionOver`: its start plus its duration, an hour
// when unknown) offers neither « Modifier la date » nor « Annuler la séance », « Espace coach v2 » on or off. A refusal
// that still reaches the page says the session is over, in the Design System's Note; the 24 hours (#883) keep their text.
vi.mock("next/navigation", () => ({ usePathname: () => "/agenda", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

/** Friday 13 November 2026, 11:00 in Paris. The clock is frozen there. */
const NOW = new Date("2026-11-13T10:00:00Z");
const t = createI18n("fr").t;
const OVER = t("coachingSession.over");
const WINDOW = t("coachingCancellation.tooLate");

const session = (id: string, scheduledAt: string, durationMinutes?: number): CoachingSessionAgendaItem => ({
  kind: "coachingSession",
  id,
  scheduledAt: new Date(scheduledAt),
  coach: { id: "c1", name: `Coach ${id}` },
  ...(durationMinutes ? { durationMinutes } : {}),
  changedBy: "candidate",
  reschedules: [],
});
const UPCOMING = session("avenir", "2026-11-16T09:00:00Z", 60);
/** Started at 10:30 Paris, for an hour: in progress. */
const IN_PROGRESS = session("encours", "2026-11-13T09:30:00Z", 60);
/** This morning, 45 minutes: over, though still under today's « À venir ». */
const ENDED_TODAY = session("matin", "2026-11-13T08:00:00Z", 45);
/** No duration: an hour, ended at 11:00 sharp. */
const ENDED_UNKNOWN = session("sansduree", "2026-11-13T09:00:00Z");
const TEN_DAYS_AGO = session("passee", "2026-11-03T09:00:00Z", 60);

const OFF = () => formatsFor("fr", NOW);
const ON = () => ({ ...formatsFor("fr", NOW, { timeZone: "Europe/Paris" }), cancellationPolicy: false });
/** On, with the cancellation policy (#883): within 24 hours of its start, a session is no longer cancelled either. */
const POLICY = () => ({ ...formatsFor("fr", NOW, { timeZone: "Europe/Paris" }), cancellationPolicy: true });
const states: [string, () => Formats][] = [
  ["off", OFF],
  ["on", ON],
  ["on, cancellation policy on", POLICY],
];

const itemOf = (item: CoachingSessionAgendaItem) => {
  const link = document.querySelector(`a.agenda-item-link[href="/coachs#seance-${item.id}"]`);
  expect(link).not.toBeNull();
  return within(link?.closest("li") as HTMLElement);
};

let zone: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  process.env.TZ = zone;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

for (const tz of ["UTC", "Europe/Paris"])
  describe(`the machine in ${tz}`, () => {
    beforeEach(() => {
      process.env.TZ = tz;
    });

    for (const [state, formats] of states)
      it(`« Espace coach v2 » ${state}: upcoming and in progress offer both actions, ended offers neither`, () => {
        const f = formats();
        expect(f.over(UPCOMING)).toBe(false);
        expect(f.over(IN_PROGRESS)).toBe(false);
        expect(f.over(ENDED_TODAY)).toBe(true);
        expect(f.over(ENDED_UNKNOWN)).toBe(true);
        expect(f.over(TEN_DAYS_AGO)).toBe(true);

        const { unmount } = renderInFrench(
          <AgendaList
            days={[{ day: "2026-11-13", items: [ENDED_TODAY, ENDED_UNKNOWN, IN_PROGRESS] }, { day: "2026-11-16", items: [UPCOMING] }]}
            past={false}
            withdrawable={new Set()}
            formats={f}
            t={t}
          />,
        );
        // In progress under the policy, it is past its 24 hours: #883's text, as before.
        if (f.cancellationPolicy) expect(itemOf(IN_PROGRESS).getAllByText(WINDOW)).toHaveLength(2);
        for (const open of f.cancellationPolicy ? [UPCOMING] : [UPCOMING, IN_PROGRESS]) {
          expect(itemOf(open).getByRole("button", { name: t("agendaChanges.cancelSessionFor", { name: open.coach.name }) })).toBeTruthy();
          expect(itemOf(open).getByRole("button", { name: /Modifier la date/ })).toBeTruthy();
        }
        for (const ended of [ENDED_TODAY, ENDED_UNKNOWN]) {
          expect(itemOf(ended).queryByRole("button")).toBeNull();
          // Nor the 24 hours' closed window: the session is over, not too close.
          expect(itemOf(ended).queryByText(WINDOW)).toBeNull();
          expect(itemOf(ended).getByText(t("agenda.withCoach", { name: ended.coach.name }))).toBeTruthy();
        }
        unmount();

        renderInFrench(<AgendaList days={[{ day: "2026-11-03", items: [TEN_DAYS_AGO] }]} past withdrawable={new Set()} formats={f} t={t} />);
        expect(itemOf(TEN_DAYS_AGO).queryByRole("button")).toBeNull();
        expect(document.querySelector(".agenda-item-time")?.textContent).toContain("10:00");
      });

    // Under the policy, its window closed 24 hours before it started.
    for (const [state, formats] of states.slice(0, 2))
      it(`« Espace coach v2 » ${state}: a session that ends while the page is open is refused in the Note, saying it is over`, async () => {
        vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "too_late" }), { status: 409 })));
        renderInFrench(<AgendaList days={[{ day: "2026-11-13", items: [IN_PROGRESS] }]} past={false} withdrawable={new Set()} formats={formats()} t={t} />);
        const user = userEvent.setup();
        await user.click(itemOf(IN_PROGRESS).getByRole("button", { name: t("agendaChanges.cancelSessionFor", { name: IN_PROGRESS.coach.name }) }));
        vi.setSystemTime(new Date("2026-11-13T10:30:00Z"));
        await user.click(screen.getByRole("button", { name: t("agendaChanges.confirm") }));
        const note = await screen.findByRole("alert");
        expect(note.textContent).toBe(OVER);
        expect(note.className).toContain("ds-note");
        expect(note.getAttribute("data-tone")).toBe("warn");
      });

    it("« Espace coach v2 » on, cancellation policy on: a refusal for the 24 hours keeps its own text", async () => {
      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "too_late" }), { status: 409 })));
      /** Tomorrow 17:00 Paris: the window closes at 17:00 today, so the button is still there. */
      const tomorrow = session("demain", "2026-11-14T16:00:00Z", 60);
      renderInFrench(<AgendaList days={[{ day: "2026-11-14", items: [tomorrow] }]} past={false} withdrawable={new Set()} formats={POLICY()} t={t} />);
      const user = userEvent.setup();
      await user.click(itemOf(tomorrow).getByRole("button", { name: t("agendaChanges.cancelSessionFor", { name: tomorrow.coach.name }) }));
      await user.click(screen.getByRole("button", { name: t("agendaChanges.confirm") }));
      const refusal = await screen.findByRole("alert");
      expect(refusal.textContent).toBe(WINDOW);
      expect(refusal.textContent).not.toBe(OVER);
    });
  });
