// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provenance } from "@jobhub/shared";
import { renderInFrench } from "@/design/testing";
import { CoachConversationPage } from "./CoachConversationPage";
import { ConversationFirstProvider } from "./conversation-first";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const CONVERSATION = { id: "66666666-6666-4666-8666-666666666666", title: "Mes candidatures", subject: null, profile: null, lastMessageAt: "2026-11-05T10:00:00.000Z" };
const AT = "2026-11-05T10:00:00.000Z";
const READ = { kind: "tool", activity: "act", tool: "applications", action: "list_objects", at: AT };
const PROFILE_READ = { kind: "tool", activity: "act", tool: "profile", action: "read_profile", at: AT };
const CHECK = { kind: "ai", activity: "think", task: "guardrail", at: AT };
const WRITE = { kind: "ai", activity: "think_write", task: "coaching", at: AT };
const ended = (step: object) => ({ ...step, ms: 5, outcome: "ok", count: 1 });
const PROVENANCE: Provenance = {
  v: 1,
  steps: [ended(READ), ended(PROFILE_READ), ended(WRITE)] as Provenance["steps"],
  sites: [{ kind: "candidate", links: ["/candidatures/a1", "/profils/p1"] }],
  startedAt: AT,
  wallMs: 900,
};
const REPLY = "Votre candidature chez Airbus avance bien et votre profil est prêt.";
/** A saved reply whose Coach Actions said what they saw (#788): the Application by its page, named by the server. */
const SAVED_PROVENANCE: Provenance = {
  ...PROVENANCE,
  steps: [
    { ...ended({ ...READ, action: "read_application" }), seen: [{ type: "application", href: "/candidatures/a1" }] },
    { ...ended(PROFILE_READ), seen: [{ type: "profile", href: "/profils/p1" }] },
    ended(WRITE),
  ] as Provenance["steps"],
};

/** The server's live reply, its events sent one by one with `send`; `/api/coach/conversations/…` gives back a saved one. */
let send: (event: object) => Promise<void>;
let close: () => Promise<void>;
function liveServer() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/coach" && init?.method === "POST") {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          send = async (event) => {
            await act(async () => {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              await new Promise((done) => setTimeout(done, 0));
            });
          };
          close = async () => {
            await act(async () => {
              controller.close();
              await new Promise((done) => setTimeout(done, 0));
            });
          };
        },
      });
      return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
    }
    if (url === `/api/coach/conversations/${CONVERSATION.id}`)
      return Response.json({
        conversation: { ...CONVERSATION, aiDisclosure: false, messages: [{ from: "candidate", text: "Où en suis-je ?" }, { from: "coach", text: REPLY, provenance: SAVED_PROVENANCE, at: AT, seenNames: { "/candidatures/a1": "Airbus · Contrôleuse de gestion" } }] },
      });
    return new Response(null, { status: 404 });
  });
}

/** Whether the Candidate asked for less motion. */
function motion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? (query.includes("reduce)") ? reduced : !reduced) : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

function Page({ conversationId = null }: { conversationId?: string | null }) {
  return (
    <ConversationFirstProvider conversations={[]}>
      <CoachConversationPage conversationId={conversationId} />
    </ConversationFirstProvider>
  );
}

const lines = () => [...document.querySelectorAll(".coach-panel-step")].map((line) => [line.textContent, line.hasAttribute("data-ended")]);
const liveGlyphs = () => [...document.querySelectorAll(".coach-panel-live svg.activity-glyph")];
const thread = () => screen.getByRole("list", { name: "Vos échanges avec votre coach" });
/** The thread's last message: the reply. */
const lastMessage = () => [...thread().querySelectorAll(":scope > li")].at(-1) as HTMLElement;

async function ask(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Votre message" }), "Où en suis-je ?{Enter}");
  await waitFor(() => expect(send).toBeTypeOf("function"));
  await send({ type: "conversation", conversation: CONVERSATION });
}

beforeEach(() => {
  vi.stubGlobal("fetch", liveServer());
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  // jsdom measures no path: the moving glyph samples its strokes all the same.
  Object.assign(SVGElement.prototype, { getTotalLength: () => 10, getPointAtLength: () => ({ x: 12, y: 12 }) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("a reply's Coach Actions live (#788): a line each, one glyph that morphs from step to step", () => {
  beforeEach(() => motion(false));

  it("each Coach Action keeps its line, with what it reads, past the Guardrail's check; the one glyph goes act, then think_write", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    await ask(user);

    await send({ type: "step_started", id: 1, step: READ, label: "act" });
    expect(lines()).toEqual([["Consulte vos données…", false]]);
    expect(liveGlyphs().map((glyph) => glyph.getAttribute("data-activity"))).toEqual(["act"]);

    await send({ type: "step_ended", id: 1, step: { ...ended(READ), seen: [{ type: "application", count: 12 }] }, names: [null] });
    await send({ type: "step_started", id: 2, step: CHECK, label: "check" });
    expect(lines()).toEqual([
      ["Consulte vos données · 12 candidatures", true],
      ["Vérification", false],
    ]);
    await send({ type: "step_ended", id: 2, step: ended(CHECK) });
    await send({ type: "step_started", id: 3, step: PROFILE_READ, label: "act" });
    await send({ type: "step_ended", id: 3, step: { ...ended(PROFILE_READ), seen: [{ type: "profile", href: "/profils/p1" }] }, names: ["Contrôleuse de gestion"] });
    await send({ type: "step_started", id: 4, step: WRITE, label: "think_write" });

    expect(lines()).toEqual([
      ["Consulte vos données · 12 candidatures", true],
      ["Ouvre le profil · Contrôleuse de gestion", true],
      ["Réflexion puis rédaction", false],
    ]);
    expect(liveGlyphs().map((glyph) => glyph.getAttribute("data-activity"))).toEqual(["think_write"]);
    // The lines are shown, never read out: only the start is announced.
    expect(document.querySelector(".coach-panel-live")!.closest("[aria-live], [role=status]")).toBeNull();
  });
});

describe("a reply once it is there (#788): no glyph in the margin, its words one by one, then what the AI Coach consulted", () => {
  async function answer(user: ReturnType<typeof userEvent.setup>) {
    await ask(user);
    await send({ type: "step_started", id: 1, step: READ, label: "act" });
    await send({ type: "reply", conversation: CONVERSATION, reply: REPLY, provenance: PROVENANCE, at: AT });
    await close();
    return lastMessage();
  }

  it("has no glyph in the margin; « Le coach a consulté 2 éléments de Jobbbox » opens on each, linked", async () => {
    motion(false);
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const reply = await answer(user);

    expect(reply.querySelector(":scope > svg.activity-glyph")).toBeNull();
    expect(document.querySelector(".coach-panel-live")).toBeNull();
    const consulted = reply.querySelector("details.coach-tools-consulted")!;
    expect(consulted.querySelector("summary")!.textContent).toBe("Le coach a consulté 2 éléments de Jobbbox");
    const links = within(consulted as HTMLElement).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Candidature", "/candidatures/a1"],
      ["Profil", "/profils/p1"],
    ]);
  });

  it("names in « Le coach a consulté… » what its Coach Actions saw, from their live ends (#788)", async () => {
    motion(false);
    const user = userEvent.setup();
    renderInFrench(<Page />);
    await ask(user);
    const opened = { ...ended({ ...READ, action: "read_application" }), seen: [{ type: "application", href: "/candidatures/a1" }] };
    await send({ type: "step_started", id: 1, step: { ...READ, action: "read_application" }, label: "act" });
    await send({ type: "step_ended", id: 1, step: opened, names: ["Airbus · Contrôleuse de gestion"] });
    await send({ type: "reply", conversation: CONVERSATION, reply: REPLY, provenance: { ...PROVENANCE, steps: [opened] }, at: AT });
    await close();

    const consulted = lastMessage().querySelector("details.coach-tools-consulted") as HTMLElement;
    expect(consulted.querySelector("summary")!.textContent).toBe("Le coach a consulté 1 élément de Jobbbox");
    const links = within(consulted).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["Airbus · Contrôleuse de gestion", "/candidatures/a1"]]);
  });

  it("shows its words one by one, each in its place, busy until the last; the full text in the page all along", async () => {
    motion(false);
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const reply = await answer(user);

    const words = [...reply.querySelectorAll(".coach-word")];
    expect(words.map((word) => word.textContent).join(" ")).toBe(REPLY);
    expect(words.map((word) => (word as HTMLElement).style.getPropertyValue("--word"))).toEqual(words.map((_, index) => String(index)));
    expect(reply.getAttribute("aria-busy")).toBe("true");
    expect(reply.textContent).toContain(REPLY);
    await waitFor(() => expect(reply.hasAttribute("aria-busy")).toBe(false), { timeout: 3000 });
  });

  it("all at once under reduced motion", async () => {
    motion(true);
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const reply = await answer(user);

    expect(reply.querySelector(".coach-word")).toBeNull();
    expect(reply.hasAttribute("aria-busy")).toBe(false);
    expect(reply.textContent).toContain(REPLY);
  });

  it("all at once for a reply from the conversation's history, which keeps its line after a reload", async () => {
    motion(false);
    renderInFrench(<Page conversationId={CONVERSATION.id} />);
    await screen.findByText(REPLY);
    const reply = lastMessage();

    expect(reply.querySelector(".coach-word")).toBeNull();
    expect(reply.hasAttribute("aria-busy")).toBe(false);
    expect(reply.querySelector(":scope > svg.activity-glyph")).toBeNull();
    expect(reply.querySelector("details.coach-tools-consulted summary")!.textContent).toBe("Le coach a consulté 2 éléments de Jobbbox");
    // Each named as the server gives it, else by its kind of page.
    expect([...reply.querySelectorAll("details.coach-tools-consulted a")].map((link) => link.textContent)).toEqual(["Airbus · Contrôleuse de gestion", "Profil"]);
  });
});
