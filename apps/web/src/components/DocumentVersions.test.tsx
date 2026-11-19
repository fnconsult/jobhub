// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { DocumentVersions, type DocumentVersionView } from "./DocumentVersions";

/**
 * « Versions » of a Tailored Document (#1079): the versions kept, newest first, each with its date, origin and language,
 * the current one said in words; one opened read-only with « Restaurer cette version », which saves it as a new version.
 */
const EDITED: DocumentVersionView = {
  version: 2,
  savedAt: "2026-11-18T13:45:00.000Z",
  source: "candidate",
  restoredFrom: null,
  current: true,
  language: "fr",
  subject: null,
  text: "Ma lettre, retouchée.",
  cv: null,
};
const DRAFTED: DocumentVersionView = { ...EDITED, version: 1, savedAt: "2026-11-18T13:30:00.000Z", source: "drafted", current: false, text: "Madame, Monsieur, votre offre…" };
const RESTORED: DocumentVersionView = { ...DRAFTED, version: 3, savedAt: "2026-11-18T14:00:00.000Z", source: "restored", restoredFrom: 1, current: true };

let answers: { status: number; body: unknown }[];
let sent: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  answers = [];
  sent = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.shift() ?? { status: 500, body: { error: "failed" } };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const versions = (letter: DocumentVersionView[]) => ({ tailored_cv: [], cover_letter: letter, outreach_message: [] });

describe("« Versions » of a Tailored Document (#1079)", () => {
  it("opens on the versions kept, newest first: date, origin and language, the current one said in words and marked current", async () => {
    answers = [{ status: 200, body: versions([EDITED, DRAFTED]) }];
    renderInFrench(<DocumentVersions applicationId="a1" document="cover_letter" locale="fr" />);

    const toggle = screen.getByRole("button", { name: "Versions" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);

    const list = await screen.findByRole("list", { name: /Versions de ce document/ });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Version 2 · Version actuelle18 novembre 2026 à 14:45 · Modifiée par vous · Français/),
      expect.stringMatching(/^Version 118 novembre 2026 à 14:30 · Rédigée par votre coach IA · Français/),
    ]);
    expect(items[0]!.getAttribute("aria-current")).toBe("true");
    expect(items[1]!.getAttribute("aria-current")).toBeNull();
    expect(sent).toEqual([{ url: "/api/applications/a1/document-versions", method: "GET", body: undefined }]);
  });

  it("opens a version read-only, with « Restaurer cette version » unless it is the current one", async () => {
    answers = [{ status: 200, body: versions([EDITED, DRAFTED]) }];
    renderInFrench(<DocumentVersions applicationId="a1" document="cover_letter" locale="fr" />);
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));

    await userEvent.click(await screen.findByRole("button", { name: "Voir la version 2" }));
    const current = screen.getByRole("region", { name: "Version 2, en lecture seule · Version actuelle" });
    expect(current.textContent).toContain("Ma lettre, retouchée.");
    expect(within(current).queryByRole("button", { name: "Restaurer cette version" })).toBeNull();
    expect(within(current).queryByRole("textbox")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Voir la version 1" }));
    const earlier = screen.getByRole("region", { name: "Version 1, en lecture seule" });
    expect(earlier.textContent).toContain("Madame, Monsieur, votre offre…");
    expect(screen.getByRole("button", { name: "Voir la version 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(earlier).getByRole("button", { name: "Restaurer cette version" })).toBeTruthy();
  });

  it("« Restaurer cette version » saves it as a new version, says so, and hands the documents as they now stand to the page", async () => {
    const restored = { versions: versions([RESTORED, EDITED, DRAFTED]), drafts: { documentLanguage: "fr" }, tailoredCv: null };
    answers = [{ status: 200, body: versions([EDITED, DRAFTED]) }, { status: 200, body: restored }];
    const onRestored = vi.fn();
    renderInFrench(<DocumentVersions applicationId="a1" document="cover_letter" locale="fr" onRestored={onRestored} />);
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    await userEvent.click(await screen.findByRole("button", { name: "Voir la version 1" }));

    await userEvent.click(screen.getByRole("button", { name: "Restaurer cette version" }));

    expect(sent.at(-1)).toEqual({ url: "/api/applications/a1/document-versions", method: "POST", body: { document: "cover_letter", version: 1 } });
    expect((await screen.findByRole("status")).textContent).toBe("Version 1 restaurée : elle est désormais la version actuelle.");
    const items = within(screen.getByRole("list", { name: /Versions de ce document/ })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toMatch(/^Version 3 · Version actuelle.*Restauration de la version 1/);
    expect(onRestored).toHaveBeenCalledWith(restored);
  });

  it("a failed Restore says so and changes nothing", async () => {
    answers = [{ status: 200, body: versions([EDITED, DRAFTED]) }, { status: 409, body: { error: "conflict" } }];
    renderInFrench(<DocumentVersions applicationId="a1" document="cover_letter" locale="fr" />);
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    await userEvent.click(await screen.findByRole("button", { name: "Voir la version 1" }));

    await userEvent.click(screen.getByRole("button", { name: "Restaurer cette version" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/n'a pas pu être restaurée/));
    expect(within(screen.getByRole("list", { name: /Versions de ce document/ })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("read-only, as a Human Coach reads them: the versions given, nothing fetched, nothing to restore", async () => {
    renderInFrench(<DocumentVersions applicationId="a1" document="cover_letter" locale="fr" initial={[EDITED, DRAFTED]} readOnly />);
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    await userEvent.click(screen.getByRole("button", { name: "Voir la version 1" }));

    expect(screen.getByRole("region", { name: "Version 1, en lecture seule" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restaurer cette version" })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("a Tailored CV's version shows its CV, and an Outreach Message's its subject", async () => {
    const cv = { fullName: "Marie Dupont", headline: "DAF groupe industriel", email: "", phone: "", location: "", summary: "", experience: [], education: [], skills: ["IFRS"], languages: [] };
    const { unmount } = renderInFrench(
      <DocumentVersions applicationId="a1" document="tailored_cv" locale="fr" initial={[{ ...DRAFTED, text: null, cv, current: true }]} readOnly />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    expect(screen.getByRole("listitem").textContent).toContain("Proposée par votre coach IA, enregistrée par vous");
    await userEvent.click(screen.getByRole("button", { name: "Voir la version 1" }));
    expect(screen.getByRole("region", { name: /Version 1, en lecture seule/ }).textContent).toContain("DAF groupe industriel");
    unmount();

    renderInFrench(<DocumentVersions applicationId="a1" document="outreach_message" locale="fr" initial={[{ ...EDITED, subject: "Poste de DAF" }]} readOnly />);
    await userEvent.click(screen.getByRole("button", { name: "Versions" }));
    await userEvent.click(screen.getByRole("button", { name: "Voir la version 2" }));
    expect(screen.getByRole("region", { name: /Version 2, en lecture seule/ }).textContent).toContain("Objet : Poste de DAF");
  });
});
