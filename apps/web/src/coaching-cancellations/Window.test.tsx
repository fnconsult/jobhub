// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { CancellationWindow } from "./Window";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("closes already-open controls just after the inclusive 24-hour boundary without navigation", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T06:29:59Z"));
  render(
    <CancellationWindow at="2026-11-02T06:30:00Z">
      <button>Cancel</button>
    </CancellationWindow>,
  );
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2);
  });
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(screen.getByText("coachingCancellation.tooLate")).not.toBeNull();
});
