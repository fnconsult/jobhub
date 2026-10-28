import { resources, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { guideOf, MAILBOX_PROVIDERS, wizardSteps } from "./forwarding-wizard";

type Guides = Record<string, { title: string; steps: Record<string, string> }>;

describe("the forwarding setup wizard's steps, mailbox provider by mailbox provider", () => {
  it("offers Gmail, Outlook.com, iCloud, Orange and « Autre »", () => {
    expect(MAILBOX_PROVIDERS).toEqual(["gmail", "outlook", "icloud", "orange", "other"]);
  });

  it("for Gmail: the address is added, then its confirmation code shown, then the filter on alert senders, then the first email", () => {
    expect(wizardSteps("gmail")).toEqual(["provider", "switchOn", "address", "guide", "confirmation", "filter", "firstEmail", "done"]);
  });

  it("for Outlook.com and iCloud, which send no code: their guide, then the first email confirms", () => {
    expect(wizardSteps("outlook")).toEqual(["provider", "switchOn", "address", "guide", "firstEmail", "done"]);
    expect(wizardSteps("icloud")).toEqual(["provider", "switchOn", "address", "guide", "firstEmail", "done"]);
  });

  it("for Orange, untested, and « Autre » (Yahoo or AOL without Mail Plus, Free, SFR…): the manual forwarding guide", () => {
    expect(wizardSteps("orange")).toEqual(["provider", "switchOn", "address", "guide", "firstEmail", "done"]);
    expect(wizardSteps("other")).toEqual(wizardSteps("orange"));
    expect(guideOf("orange", "guide")).toEqual(guideOf("other", "guide"));
    expect(guideOf("other", "guide").name).toBe("manual");
  });

  it("gives Gmail two guides: adding the address, then the filter", () => {
    expect(guideOf("gmail", "guide").name).toBe("gmailAddress");
    expect(guideOf("gmail", "filter").name).toBe("gmailFilter");
  });

  it("has every guide's title and steps written in French and English", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const guides = (resources[locale].translation as unknown as { forwardingWizard: { guides: Guides } }).forwardingWizard.guides;
      for (const provider of MAILBOX_PROVIDERS) {
        for (const step of wizardSteps(provider).filter((each) => each === "guide" || each === "filter")) {
          const { name, steps } = guideOf(provider, step);
          expect(guides[name]?.title, `${locale} ${name}`).toBeTruthy();
          expect(Object.keys(guides[name]?.steps ?? {}), `${locale} ${name}`).toEqual(Array.from({ length: steps }, (_, index) => String(index + 1)));
        }
      }
    }
  });
});
