// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachingSessionDialog } from "./CoachingSessionDialog";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])("only sends fields actually edited, including a stale date drawer (video editor %s)", async (withVideoLink) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", request);
  renderInFrench(
    <CoachingSessionDialog
      session={{ id: "session-1", scheduledAt: "2026-11-11T12:00", durationMinutes: 90, videoLink: "https://meet.google.com/old", note: "Reminder" }}
      withName="Sophie"
      withVideoLink={withVideoLink}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Modifier la date/ }));
  fireEvent.change(screen.getByLabelText("Date et heure de la séance (heure de Paris)"), { target: { value: "2026-11-12T12:00" } });
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ scheduledAt: "2026-11-12T12:00" });
});
