// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/profils/nouveau", useRouter: () => ({ push, refresh: vi.fn() }) }));

/** /profils/nouveau: the conversation in the page, the Work Pane beside it. */
function NewProfilePage() {
  return (
    <WorkPaneProvider version="1.2.3">
      <main>
        <ProfileOnboarding />
      </main>
      <WorkPane />
    </WorkPaneProvider>
  );
}

const conversation = () => screen.getByRole("region", { name: "Créer un profil avec votre coach" });
const thread = () => screen.getByRole("list", { name: "Votre échange avec le coach" });
const reviewPane = () => screen.getByRole("complementary", { name: "Vérifiez votre CV et vos critères de recherche" });

describe("creating a Profile is a conversation with the AI Coach (ADR-0070)", () => {
  beforeEach(() => push.mockClear());

  it("opens on the Coach's Introduction, the CV's drop zone a card in the thread, the Questionnaire a suggestion above the box", () => {
    renderInFrench(<NewProfilePage />);
    expect(within(thread()).getByText(/Je vous aide à construire votre CV de référence/)).toBeTruthy();
    expect(within(thread()).getByRole("heading", { name: "J'ai un CV" })).toBeTruthy();
    expect(within(thread()).getByLabelText("Votre CV")).toBeTruthy();
    const suggestions = within(conversation()).getByRole("group", { name: "Suggestions" });
    expect(within(suggestions).getByRole("button", { name: "Répondre aux questions de mon coach" })).toBeTruthy();
  });

  it("asks the Questionnaire in the thread and takes the answers in the box at the foot", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Répondre aux questions de mon coach" }));

    const box = screen.getByLabelText("Votre réponse");
    expect(document.activeElement).toBe(box);
    expect(within(thread()).getByText(/Bonjour, je suis votre coach Jobbbox/)).toBeTruthy();
    expect(within(thread()).getByText("Répondre aux questions de mon coach")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "J'ai un CV" })).toBeNull();

    // A required question can't be left empty.
    await user.click(screen.getByRole("button", { name: "Répondre" }));
    expect(screen.getByRole("alert").textContent).not.toBe("");

    await user.type(box, "Marie Dupont{Enter}");
    expect(within(thread()).getByText("Marie Dupont")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Votre réponse"));
  });

  it("reviews an empty draft in the Work Pane when starting from scratch, and keeps what was changed when the pane closes", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));

    expect(within(thread()).getByText(/Remplissez votre CV de référence/)).toBeTruthy();
    await user.type(within(reviewPane()).getByLabelText("Nom et prénom"), "Marie Dupont");
    await user.click(within(reviewPane()).getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Relire et enregistrer" }));
    expect((within(reviewPane()).getByLabelText("Nom et prénom") as HTMLInputElement).value).toBe("Marie Dupont");
  });

  it("starts over from the review: the two paths again, the pane closed", async () => {
    const user = userEvent.setup();
    renderInFrench(<NewProfilePage />);
    await user.click(screen.getByRole("button", { name: "Partir de zéro" }));
    await user.click(within(reviewPane()).getByRole("button", { name: "Importer un autre CV" }));

    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
    expect(within(thread()).getByRole("heading", { name: "J'ai un CV" })).toBeTruthy();
  });
});
