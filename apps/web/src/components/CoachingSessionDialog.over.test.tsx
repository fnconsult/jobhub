// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CancelAgendaItemButton } from "./CancelAgendaItemButton";
import { CoachingSessionDialog } from "./CoachingSessionDialog";

// « Espace coach v2 » off (#1022): a session that ended while the page was open is refused 409 « too_late »;
// the dialog and « Annuler la séance » say so in a Note, not as a failed save.
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
const refused = (body: unknown, status: number) => vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
const OVER = "Cette séance est passée : elle ne peut plus être modifiée ni annulée.";

it("the dialog, off: a session that has ended is announced in a warning Note", async () => {
  vi.stubGlobal("fetch", refused({ error: "too_late" }, 409));
  renderInFrench(
    <CoachingSessionDialog
      session={{ id: "s1", scheduledAt: "2026-11-13T09:00", durationMinutes: 60, videoLink: null, note: null }}
      withName="Sophie"
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Modifier la date/ }));
  fireEvent.change(screen.getByLabelText("Date et heure de la séance (heure de Paris)"), { target: { value: "2026-11-14T09:00" } });
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  const note = await screen.findByRole("alert");
  expect(note.textContent).toContain(OVER);
  expect(note.className).toContain("ds-note");
  expect(note.getAttribute("data-tone")).toBe("warn");
});

it("the dialog, off: any other failure is still « L'enregistrement a échoué »", async () => {
  vi.stubGlobal("fetch", refused({ error: "not_found" }, 404));
  renderInFrench(
    <CoachingSessionDialog
      session={{ id: "s1", scheduledAt: "2026-11-13T09:00", durationMinutes: 60, videoLink: null, note: null }}
      withName="Sophie"
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Modifier la date/ }));
  await user.click(screen.getByRole("button", { name: "Enregistrer" }));
  const note = await screen.findByRole("alert");
  expect(note.textContent).toContain("L'enregistrement a échoué");
  expect(note.getAttribute("data-tone")).toBe("danger");
});

it("« Annuler la séance » with `tooLate`: the refusal is that Note; without it, as before", async () => {
  vi.stubGlobal("fetch", refused({ error: "too_late" }, 409));
  const user = userEvent.setup();
  const { unmount } = renderInFrench(<CancelAgendaItemButton url="/api/coaching/sessions/s1/cancel" label="Annuler la séance" name="Annuler" question="Sûr ?" tooLate={OVER} />);
  await user.click(screen.getByRole("button", { name: "Annuler" }));
  await user.click(screen.getByRole("button", { name: "Oui, annuler" }));
  const note = await screen.findByRole("alert");
  expect(note.textContent).toContain(OVER);
  expect(note.getAttribute("data-tone")).toBe("warn");
  unmount();

  renderInFrench(<CancelAgendaItemButton url="/api/coaching/sessions/s1/cancel" label="Annuler la séance" name="Annuler" question="Sûr ?" />);
  await user.click(screen.getByRole("button", { name: "Annuler" }));
  await user.click(screen.getByRole("button", { name: "Oui, annuler" }));
  expect((await screen.findByRole("alert")).className).toBe("field-error");
});
