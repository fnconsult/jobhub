// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachConversationPage";
import { ConversationFirstProvider } from "./conversation-first";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

function HomePage() {
  return (
    <ConversationFirstProvider conversations={[]}>
      <CoachConversationPage conversationId={null} />
    </ConversationFirstProvider>
  );
}

const box = () => screen.getByRole("textbox", { name: "Votre message" }) as HTMLTextAreaElement;

describe("the conversation's message box (#933)", () => {
  beforeEach(() => {
    // A browser without `field-sizing: content`: the box's height follows its text's, each line 24px.
    vi.stubGlobal("CSS", { supports: () => false });
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
      return this.value.split("\n").length * 24;
    });
    // The reply never comes: what matters is the box once sent.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new ReadableStream(), { headers: { "content-type": "application/x-ndjson" } })),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts on one line, the « Coach IA » badge and « Envoyer au coach » in the same box", () => {
    renderInFrench(<HomePage />);

    expect(box().rows).toBe(1);
    expect(box().style.height).toBe("24px");
    const composer = box().closest(".coach-panel-composer")!;
    expect(composer.classList.contains("coach-panel-composer-inline")).toBe(true);
    expect(composer.querySelector(".coach-panel-badge")?.textContent).toBe("Coach IA");
    expect(composer.querySelector("button[type=submit]")?.textContent).toBe("Envoyer au coach");
  });

  it("grows with what the Candidate writes, Shift+Enter starting a line, and is one line again once sent", async () => {
    const user = userEvent.setup();
    renderInFrench(<HomePage />);

    await user.type(box(), "Bonjour,{Shift>}{Enter}{/Shift}je prépare{Shift>}{Enter}{/Shift}un entretien");
    expect(box().value.split("\n")).toHaveLength(3);
    expect(box().style.height).toBe("72px");

    await user.type(box(), "{Enter}");
    await waitFor(() => expect(box().value).toBe(""));
    expect(box().style.height).toBe("24px");
  });
});
