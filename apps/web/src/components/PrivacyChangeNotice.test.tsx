// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { PrivacyChangeNotice } from "./PrivacyChangeNotice";

describe("PrivacyChangeNotice — the privacy policy's substantial change, shown once (#547)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says the policy changed on its date, links to it, and has « J'ai compris », with no box", () => {
    renderInFrench(<PrivacyChangeNotice change={{ version: "2026-10-01", url: "/legal/confidentialite/2026-10-01" }} />);

    const notice = screen.getByRole("region", { name: "Changement de la politique de confidentialité" });
    expect(within(notice).getByText("Notre politique de confidentialité a changé le 1 octobre 2026.")).toBeTruthy();
    expect(within(notice).getByRole("link", { name: "Lire la politique de confidentialité" }).getAttribute("href")).toBe("/legal/confidentialite/2026-10-01");
    expect(within(notice).getByRole("button", { name: "J'ai compris" })).toBeTruthy();
    expect(within(notice).queryByRole("checkbox")).toBeNull();
  });

  it("closes on « J'ai compris », and tells the server which version was closed", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    renderInFrench(<PrivacyChangeNotice change={{ version: "2026-10-01", url: "/legal/confidentialite/2026-10-01" }} />);

    await userEvent.click(screen.getByRole("button", { name: "J'ai compris" }));

    expect(screen.queryByRole("region", { name: "Changement de la politique de confidentialité" })).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/privacy-change/2026-10-01", { method: "DELETE" });
  });
});
