// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityLiveProvider, useAiActivityLive, type RequestActionLive } from "./AiActivityLive";

vi.mock("next/navigation", () => ({ usePathname: () => "/agenda" }));

type Live = NonNullable<ReturnType<typeof useAiActivityLive>>;

/** Hands the test the live actions' API, as a page's conversation uses it. */
function Grab({ onLive }: { onLive: (live: Live) => void }) {
  const live = useAiActivityLive();
  useEffect(() => {
    if (live) onLive(live);
  }, [live, onLive]);
  return null;
}

const announced = () => document.querySelector(".ai-activity-announcer")?.textContent ?? "";

/**
 * AI Activity's live region and the AI Coach replies (#333, #608): a page that is a conversation says its own replies'
 * start and end; a reply whose page was left (the Candidate moved on to another page, a conversation too) is AI
 * Activity's to say when it ends, as it was once the Coach Panel had closed.
 */
describe("AI Activity's live region and a Coach reply", () => {
  function start(): RequestActionLive {
    let live: Live | null = null;
    renderInFrench(
      <AiActivityLiveProvider>
        <Grab onLive={(given) => (live = given)} />
      </AiActivityLiveProvider>,
    );
    let reply: RequestActionLive | null = null;
    act(() => {
      live!.conversationShown(true);
      reply = live!.requestAction("coach_reply", "/candidatures", () => {});
    });
    return reply!;
  }

  it("leaves a reply's end to the conversation shown that asked it", () => {
    const reply = start();
    act(() => reply.end("stopped"));
    expect(announced()).toBe("");
  });

  it("says the end of a reply whose page was left, though another conversation is shown", () => {
    const reply = start();
    // The Candidate moves on to the Agenda, a conversation too: the reply is « En cours ailleurs ».
    act(() => reply.leave());
    act(() => reply.end("stopped"));
    expect(announced()).toBe("Réponse du coach arrêtée");
  });
});
