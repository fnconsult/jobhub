// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ShareDocumentButton } from "./ShareDocumentButton";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("appears and disappears as the window changes without reopening the document page", async () => {
  vi.useFakeTimers();
  let open = false;
  const request = vi.fn(async () => ({
    ok: true,
    json: async () => ({ nextChangeAt: new Date(Date.now() + 1000).toISOString(), sessions: open ? [{ id: "session-1", coachName: "Sophie" }] : [] }),
  }));
  vi.stubGlobal("fetch", request);
  renderInFrench(<ShareDocumentButton source={{ kind: "profile", id: "7edf7432-bc4a-40e7-9442-10c7b0f48066" }} />);
  await act(async () => {});
  expect(screen.queryByRole("button", { name: /Montrer à mon coach/ })).toBeNull();
  open = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(screen.getByRole("button", { name: /Montrer à mon coach/ })).toBeTruthy();
  open = false;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(screen.queryByRole("button", { name: /Montrer à mon coach/ })).toBeNull();
  cleanup();
  const count = request.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledTimes(count);
});
