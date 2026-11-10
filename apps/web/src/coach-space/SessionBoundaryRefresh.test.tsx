// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionBoundaryRefresh } from "./SessionBoundaryRefresh";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  router.refresh.mockClear();
});
it.each(["2026-11-10T11:49:59Z", "2026-11-10T12:59:59Z", "2026-11-10T13:29:59Z"])("refreshes the nearest boundary without navigating (%s)", async (now) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  render(<SessionBoundaryRefresh scheduledAt="2026-11-10T12:00:00Z" durationMinutes={60} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
