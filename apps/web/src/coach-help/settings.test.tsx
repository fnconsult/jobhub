// @vitest-environment jsdom
import { article } from "@jobhub/help";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HelpIntro } from "@/components/CoachHelp";
import { renderInFrench } from "@/design/testing";
import { HelpSettingsProvider } from "./settings";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn() }) }));

// #867 (ADR-0106): the Coach Panel's « Sur cette page » reads the Help Articles « Espace coach v2 » serves, as the
// server read it for the page (HelpSettingsProvider); main's while it is off, or without the provider.
describe("HelpSettingsProvider — « Sur cette page » in the Coach Panel", () => {
  const intro = <HelpIntro pathname="/coachs/annulations" locale="fr" onOpen={() => {}} />;
  const mine = article("page-human-coaches", "fr")!.title;
  const cancellations = article("page-coaching-cancellations", "fr", { coachSpaceV2: true })!.title;

  it("off (no provider, or off): the page's article main served", () => {
    renderInFrench(intro);
    expect(screen.getByText(mine)).toBeTruthy();
    expect(screen.queryByText(cancellations)).toBeNull();
  });

  it("off, said by the provider: the same", () => {
    renderInFrench(<HelpSettingsProvider coachSpaceV2={false}>{intro}</HelpSettingsProvider>);
    expect(screen.getByText(mine)).toBeTruthy();
  });

  it("on: the epic's article of that page", () => {
    renderInFrench(<HelpSettingsProvider coachSpaceV2>{intro}</HelpSettingsProvider>);
    expect(screen.getByText(cancellations)).toBeTruthy();
    expect(screen.queryByText(mine)).toBeNull();
  });
});
