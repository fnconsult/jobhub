// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { CoachPanel } from "./CoachPanel";
import { HelpTerm } from "./HelpTerm";

vi.mock("next/navigation", () => ({ usePathname: () => "/profils/p/propositions", useRouter: () => ({ refresh: vi.fn() }) }));

/** A page in the Coach Panel naming « propositions » once, in a paragraph keyed `key`: a new key mounts it anew. */
const page = (key: string, mentions = 1) => (
  <CoachPanel>
    <main>
      <p key={key}>
        {Array.from({ length: mentions }, (_, index) => (
          <HelpTerm key={index} term="proposals">
            propositions
          </HelpTerm>
        ))}
      </p>
    </main>
  </CoachPanel>
);
const terms = () => screen.queryAllByRole("button", { name: /^propositions \(aide\)$/i });

describe("a HelpTerm mounted anew on the same page (#343)", () => {
  it("is still the button that opens its article, not plain text", async () => {
    const view = renderInFrench(page("a"));
    expect(terms()).toHaveLength(1);

    // Mounted anew in place of itself: it renders while the mention it replaces still holds the page's first place.
    await act(async () => view.rerender(<I18nProvider locale="fr">{page("b")}</I18nProvider>));

    expect(terms()).toHaveLength(1);
  });

  it("is still a button only the first time the page names the term", async () => {
    const view = renderInFrench(page("a", 2));
    expect(terms()).toHaveLength(1);

    await act(async () => view.rerender(<I18nProvider locale="fr">{page("b", 2)}</I18nProvider>));

    expect(terms()).toHaveLength(1);
  });
});
