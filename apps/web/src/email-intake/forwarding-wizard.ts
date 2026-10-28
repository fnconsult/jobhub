/**
 * The forwarding setup wizard's steps (#451), mailbox provider by mailbox provider: what the Candidate goes through to
 * forward their offer emails to their Forwarding address. Client-safe: no server code.
 *
 *   wizardSteps("gmail") // ["provider", "switchOn", "address", "guide", "confirmation", "filter", "firstEmail", "done"]
 *   guideOf("gmail", "filter") // { name: "gmailFilter", steps: 6 }: texts at forwardingWizard.guides.gmailFilter.steps.1…6
 *
 * Gmail sends a confirmation code to the address it forwards to, and forwards by a filter only to a confirmed address:
 * address, code, then filter (docs/research/issue-451.md). Outlook.com and iCloud send no code: the first email that
 * arrives confirms. Orange is untested (no official guide found), so it shares « Autre »'s manual forwarding guide, with
 * a notice; so do Yahoo and AOL without Mail Plus, Free and SFR. Guides name no menu label as certain: they change.
 */

export const MAILBOX_PROVIDERS = ["gmail", "outlook", "icloud", "orange", "other"] as const;
export type MailboxProvider = (typeof MAILBOX_PROVIDERS)[number];

export type WizardStep = "provider" | "switchOn" | "address" | "guide" | "confirmation" | "filter" | "firstEmail" | "done";

/** A provider's guide: its texts' name, and how many numbered steps it has. */
export interface Guide {
  name: "gmailAddress" | "gmailFilter" | "outlook" | "icloud" | "manual";
  steps: number;
}

const GUIDES: Record<Guide["name"], number> = { gmailAddress: 5, gmailFilter: 6, outlook: 6, icloud: 5, manual: 4 };

export function wizardSteps(provider: MailboxProvider): WizardStep[] {
  const middle: WizardStep[] = provider === "gmail" ? ["guide", "confirmation", "filter"] : ["guide"];
  return ["provider", "switchOn", "address", ...middle, "firstEmail", "done"];
}

/** The guide the `guide` step (or Gmail's `filter` step) shows for `provider`. */
export function guideOf(provider: MailboxProvider, step: "guide" | "filter"): Guide {
  const name: Guide["name"] = provider === "gmail" ? (step === "filter" ? "gmailFilter" : "gmailAddress") : provider === "outlook" || provider === "icloud" ? provider : "manual";
  return { name, steps: GUIDES[name] };
}
