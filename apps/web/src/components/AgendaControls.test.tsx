// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgendaDayButton } from "./AgendaControls";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function Day({ day }: { day: string }) {
  return (
    <AgendaDayButton day={day} href={`/agenda?vue=mois&date=${day}`} label={day} selected={false} today={false}>
      {day.slice(-2)}
    </AgendaDayButton>
  );
}

/**
 * A day of the month grid (#251), chosen from the keyboard, keeps the focus: in the Work Pane (#606) the day's address
 * draws the month anew (InWorkPane mounts one view per address), so the chosen day's new button takes it back.
 */
describe("a day of the Agenda's month grid", () => {
  it("goes to its address in place, and keeps the focus once the month is drawn anew", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Day day="2026-11-01" />
        <Day day="2026-11-15" />
      </>,
    );
    screen.getByRole("button", { name: "2026-11-15" }).focus();
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/agenda?vue=mois&date=2026-11-15", { scroll: false });

    // The month at the day's address: new buttons, the old ones gone with the focus.
    cleanup();
    render(
      <>
        <Day day="2026-11-01" />
        <Day day="2026-11-15" />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2026-11-15" }));
  });

  it("drawn first out of the page (the pane's previous body), then in it, takes the focus once in it", async () => {
    const user = userEvent.setup();
    render(<Day day="2026-11-20" />);
    screen.getByRole("button", { name: "2026-11-20" }).focus();
    await user.keyboard("{Enter}");
    cleanup();

    // The Work Pane draws the new address's view into the body it had, removed meanwhile, then into its new one.
    const detached = document.createElement("div");
    render(<Day day="2026-11-20" />, { container: detached });
    render(<Day day="2026-11-20" />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "2026-11-20" }));
  });

  it("takes no focus when the month is drawn without one chosen", () => {
    render(<Day day="2026-11-03" />);
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "2026-11-03" }));
  });
});
