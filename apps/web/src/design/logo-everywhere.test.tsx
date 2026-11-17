// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";

vi.mock("@/i18n/server", () => ({ getServerT: async () => (key: string) => (key === "app.name" ? "Jobbbox" : key), getRequestLocale: async () => "fr" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useServerInsertedHTML: () => {} }));

import GlobalError from "@/app/global-error";
import { FailedPage } from "@/components/FailedPage";
import { selfContainedPage } from "./self-contained-page";
import { SignInStage } from "./SignInStage";

/** The logo where Jobbbox presents itself (#988): its symbol, still and decorative, then the name in text. */
function expectLogo(lockup: Element | null) {
  expect(lockup).not.toBeNull();
  expect(lockup!.textContent).toBe("Jobbbox");
  const symbol = lockup!.querySelector("svg.ds-logo")!;
  expect(symbol).not.toBeNull();
  expect(symbol.getAttribute("aria-hidden")).toBe("true");
  expect(symbol.hasAttribute("data-animated")).toBe(false);
}

describe("the logo on the pages outside the shells (#988, ADR-0105)", () => {
  it("heads « Se connecter à Jobbbox » and its second step, above their title", async () => {
    const { container } = render((await SignInStage({ title: "Se connecter à Jobbbox", children: null })) as ReactElement);
    expectLogo(container.querySelector(".ds-sign-in__wordmark"));
  });

  it("leads home from a page that failed", () => {
    const { container } = renderInFrench(<FailedPage error={new Error("boom")} retry={() => {}} />);
    const home = container.querySelector(".ds-error-page__wordmark")!;
    expectLogo(home);
    expect(home.getAttribute("href")).toBe("/");
  });

  it("leads home from the page drawn when the root layout failed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<GlobalError error={new Error("boom")} retry={() => {}} />, { container: document.documentElement });
    expectLogo(container.querySelector(".ds-error-page__wordmark"));
  });

  it("heads the self-contained pages (maintenance, the web app not answering, #833) with the flat symbol, inline", () => {
    const html = selfContainedPage({ lang: "fr", title: "Maintenance", code: 503, sections: [{ lang: "fr", html: "<h1>Maintenance</h1>" }], action: "Réessayer" });
    const document = new DOMParser().parseFromString(html, "text/html");
    const wordmark = document.querySelector(".wordmark")!;
    expect(wordmark.textContent).toBe("Jobbbox");
    const symbol = wordmark.querySelector("svg")!;
    expect(symbol.getAttribute("aria-hidden")).toBe("true");
    // Nothing to load: no image, no stylesheet, the symbol drawn in the page.
    expect(html).not.toMatch(/<img|<link /);
    expect(symbol.querySelectorAll("circle")).toHaveLength(0);
  });
});
