import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { screen, userEvent, within } from "@testing-library/react-native";
import { Slot } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Linking, Text } from "react-native";
import { AppProviders } from "../app-providers";
import { METRICS, setWindow } from "../testing";
import { ROW_MAX_SCALE } from "../ui/AppText";
import { fakeNetwork, memoryStorage } from "../offline/testing";
import type { CalendarSheets } from "./add-to-calendar";
import type { Agenda } from "./agenda-read";
import { AgendaList } from "./AgendaList";

const NOW = new Date("2026-10-20T08:00:00.000Z");

const AGENDA: Agenda = {
  toSchedule: [
    { id: "s0", coach: { id: "c2", name: "Paul Durand", bookingUrl: "https://cal.com/paul-durand" }, paidAt: "2026-10-18T10:00:00.000Z", reschedules: [] },
  ],
  days: [
    {
      day: "2026-10-22",
      items: [
        {
          kind: "interview",
          id: "i1",
          applicationId: "a1",
          jobTitle: "Responsable qualité",
          employer: "Aéroline",
          scheduledAt: "2026-10-22T12:30:00.000Z",
          durationMinutes: 45,
          format: "video",
          place: "https://teams.example.com/l/abc",
          note: null,
          cancelledAt: null,
          reschedules: [],
        },
        {
          kind: "interview",
          id: "i2",
          applicationId: "a2",
          jobTitle: "Directrice financière",
          employer: "Acme Industrie",
          scheduledAt: "2026-10-22T14:00:00.000Z",
          durationMinutes: null,
          format: "on_site",
          place: "12 rue de la Paix, Paris",
          note: null,
          cancelledAt: "2026-10-19T09:00:00.000Z",
          reschedules: [],
        },
      ],
    },
    {
      day: "2026-10-23",
      items: [
        {
          kind: "coachingSession",
          id: "s1",
          coach: { id: "c1", name: "Claire Martin" },
          scheduledAt: "2026-10-23T07:00:00.000Z",
          durationMinutes: 60,
          videoLink: "https://meet.example.com/abc",
          note: null,
          changedBy: "coach",
          reschedules: [],
        },
      ],
    },
  ],
};

/** The calendar's sheets, recording what « Ajouter au calendrier » gave them. */
function fakeSheets() {
  const events: string[] = [];
  const sheets: CalendarSheets = {
    newEvent: async (event) => {
      events.push(event.title);
      return "shown";
    },
    shareFile: async () => {},
  };
  return { sheets, events };
}

async function renderAgenda(agenda: Agenda = AGENDA, sheets: CalendarSheets = fakeSheets().sheets) {
  const i18n = createI18n(DEFAULT_LOCALE);
  const Placeholder = () => <Text>Page suivante</Text>;
  await renderRouter(
    {
      _layout: () => (
        <AppProviders i18n={i18n} initialMetrics={METRICS} device={{ storage: memoryStorage(), network: fakeNetwork(true) }}>
          <Slot />
        </AppProviders>
      ),
      agenda: () => <AgendaList agenda={agenda} sheets={sheets} now={NOW} />,
      "candidatures/[id]/[section]": Placeholder,
      coachs: Placeholder,
    },
    { initialUrl: "/agenda" },
  );
}

describe("the Agenda, as a list", () => {
  it("puts « À planifier » first, each Unscheduled Coaching Session with its Human Coach's booking link", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await renderAgenda();
    const headings = screen.getAllByRole("heading").map((heading) => heading.props.children);
    expect(headings).toEqual(["À planifier", "jeudi 22 octobre", "vendredi 23 octobre"]);
    expect(screen.getByText("Séance avec Paul Durand, payée le 18 octobre 2026")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "Choisir mon créneau avec Paul Durand sur Cal.com" }));
    expect(open).toHaveBeenCalledWith("https://cal.com/paul-durand");
  });

  it("lists the Agenda Items by day, with their time in French time", async () => {
    await renderAgenda();
    const interview = screen.getByRole("link", { name: /Responsable qualité/ });
    expect(within(interview).getByText("14:30")).toBeOnTheScreen();
    expect(within(interview).getByText("Aéroline")).toBeOnTheScreen();
    const session = screen.getByRole("link", { name: /Claire Martin/ });
    expect(within(session).getByText("09:00")).toBeOnTheScreen();
    expect(within(session).getByText("60 min")).toBeOnTheScreen();
  });

  it("strikes a Cancelled Interview through, with its date of cancellation, and offers no « Ajouter à mon calendrier »", async () => {
    await renderAgenda();
    const cancelled = screen.getByRole("link", { name: /Directrice financière/ });
    expect(within(cancelled).getByText("Entretien annulé")).toBeOnTheScreen();
    expect(within(cancelled).getByText("Directrice financière")).toHaveStyle({ textDecorationLine: "line-through" });
    expect(screen.getByText("Annulé le 19 octobre 2026")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /Ajouter à mon calendrier : Directrice financière/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Ajouter à mon calendrier/ })).toHaveLength(2);
  });

  it("says « modifié par le coach » when the Human Coach last changed the session's date", async () => {
    await renderAgenda();
    expect(within(screen.getByRole("link", { name: /Claire Martin/ })).getByText("modifié par le coach")).toBeOnTheScreen();
    expect(within(screen.getByRole("link", { name: /Responsable qualité/ })).queryByText("modifié par le coach")).toBeNull();
  });

  it("leads an Interview to its Application's Interviews Section, and a Coaching Session to its Human Coach", async () => {
    await renderAgenda();
    const user = userEvent.setup();
    await user.press(screen.getByRole("link", { name: /Responsable qualité/ }));
    expect(screen).toHavePathname("/candidatures/a1/entretiens");

    await renderAgenda();
    await user.press(screen.getByRole("link", { name: /Claire Martin/ }));
    expect(screen).toHavePathname("/coachs");
  });

  it("adds an Agenda Item to the calendar through the system's sheet", async () => {
    const { sheets, events } = fakeSheets();
    await renderAgenda(AGENDA, sheets);
    await userEvent.setup().press(screen.getByRole("button", { name: "Ajouter à mon calendrier : Responsable qualité, 22 octobre 2026 à 14:30" }));
    expect(events).toEqual(["Entretien — Responsable qualité, Aéroline"]);
  });

  it("says when nothing is planned", async () => {
    await renderAgenda({ toSchedule: [], days: [] });
    expect(screen.getByText(/Aucun rendez-vous à venir/)).toBeOnTheScreen();
  });
});

describe("the Agenda, at a large system text size", () => {
  afterEach(() => setWindow({ width: 375, height: 667, fontScale: 1 }));

  it("lets an Agenda Item's words grow up to twice their size, as an object's row", async () => {
    setWindow({ width: 375, height: 667, fontScale: 3.571 });
    await renderAgenda();
    for (const text of ["Responsable qualité", "Aéroline", "avec Claire Martin"]) {
      expect(screen.getByText(text).props.maxFontSizeMultiplier).toBe(ROW_MAX_SCALE);
    }
  });
});
