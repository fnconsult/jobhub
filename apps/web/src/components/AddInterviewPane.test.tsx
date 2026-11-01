// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AddInterviewForm, type InterviewableApplication } from "./AddInterviewDialog";
import { InWorkPane, WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/agenda", useRouter: () => ({ push, refresh }) }));

const APPLICATION: InterviewableApplication = { id: "a1", jobTitle: "DAF H/F", employer: "Acme", status: "interview" };

/** The Agenda's menu conversation at « ajouter=entretien »: the form adding an Interview in the Work Pane beside it. */
function AgendaAddingAnInterview({ applications = [APPLICATION] }: { applications?: InterviewableApplication[] }) {
  return (
    <WorkPaneProvider version="1.2.3">
      <main>
        <InWorkPane kind="form" title="Ajouter un entretien" href="/agenda?ajouter=entretien" back="/agenda">
          <AddInterviewForm applications={applications} />
        </InWorkPane>
      </main>
      <WorkPane />
    </WorkPaneProvider>
  );
}

const pane = () => screen.getByRole("complementary", { name: "Ajouter un entretien" });

describe("« Ajouter un entretien » opens its form in the Work Pane beside the Agenda's conversation (#606, ADR-0070)", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the form in the pane, under its title", () => {
    renderInFrench(<AgendaAddingAnInterview />);
    expect(within(pane()).getByRole("combobox", { name: /Candidature/ })).toBeTruthy();
    expect(within(pane()).getByRole("button", { name: "Ajouter l’entretien" })).toBeTruthy();
  });

  it("adds the Interview, then closes the pane, back to the Agenda's address", async () => {
    const fetch = vi.fn(async () => Response.json({ interview: { id: "i1" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<AgendaAddingAnInterview />);

    await user.selectOptions(within(pane()).getByRole("combobox", { name: /Candidature/ }), "a1");
    fireEvent.change(within(pane()).getByLabelText(/^Date et heure/), { target: { value: "2026-11-04T10:00" } });
    await user.click(within(pane()).getByRole("button", { name: "Ajouter l’entretien" }));

    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(fetch).toHaveBeenCalledWith("/api/applications/a1/interviews", expect.objectContaining({ method: "POST" }));
    expect(push).toHaveBeenCalledWith("/agenda", { scroll: false });
  });

  it("says there is no ongoing Application to add one to", () => {
    renderInFrench(<AgendaAddingAnInterview applications={[]} />);
    expect(within(pane()).getByText(/Aucune candidature en cours/)).toBeTruthy();
  });
});
