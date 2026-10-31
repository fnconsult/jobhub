import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditStylesheet } from "@jobhub/shared/design";
import { describe, expect, it } from "vitest";

// ADR-0053, #469: the Agenda (its list, week and month), Mon compte's Sections and Mon abonnement, drawn in the Confort
// Density with the Design System's components (SegmentedLinks, Card, Pill, Note, Field, Checkbox, Button, EmptyState),
// not with the old markup restyled. Each page keeps only its own layout in a stylesheet beside it.
const app = fileURLToPath(new URL("./", import.meta.url));
const components = join(app, "../components");

/** Every page component under `path`. */
function pages(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(".tsx") && !path.endsWith(".test.tsx") ? [path] : [];
  return readdirSync(path).flatMap((name) => pages(join(path, name)));
}

const PAGES = [
  join(app, "agenda/page.tsx"),
  join(app, "abonnement/page.tsx"),
  ...pages(join(app, "compte/(sections)")),
  // Mes données, the Section open before the CGU Acceptance (ADR-0062), and the frame both groups share.
  ...pages(join(app, "compte/(open-before-acceptance)")),
  join(app, "compte/account-layout.tsx"),
  // What the Agenda draws.
  join(components, "RescheduleHistory.tsx"),
  join(components, "CoachingSessionDialog.tsx"),
  join(components, "AddInterviewDialog.tsx"),
  // What Mon compte's Sections draw.
  join(components, "AccountSettings.tsx"),
  join(components, "TextSizeControl.tsx"),
  join(components, "AppointmentRemindersForm.tsx"),
  join(components, "FollowUpDelaysForm.tsx"),
  join(components, "EuAiConsentForm.tsx"),
  join(components, "EmailIntakeForm.tsx"),
  join(components, "SendingAddresses.tsx"),
  join(components, "RecognisedSenders.tsx"),
  join(components, "SignInMethods.tsx"),
  join(components, "MySignalements.tsx"),
  join(components, "AccountDataSection.tsx"),
  // What Mon abonnement draws: the failed-payment Note and the quota-reached card.
  join(components, "PaymentFailedNotice.tsx"),
  join(components, "UpgradePrompt.tsx"),
];

/** The old markup's classes, each with the Design System component that replaces it. */
const OLD_CLASSES: Record<string, string> = {
  "agenda-views": "SegmentedLinks",
  "table-scroll": "the plan cards",
  "plan-table": "the plan cards",
  "usage-tiles": "the usage bars",
  pill: "Pill",
  button: "Button / buttonClass",
  "button-primary": "Button / buttonClass",
  "button-quiet": "Button / buttonClass",
  "button-danger": "Button / buttonClass",
  input: "TextInput / Select",
  field: "Field",
  hint: "Field's hint",
  "field-error": "Field's error",
  "checkbox-field": "Checkbox",
  notice: "Note / EmptyState",
  lead: "Card",
};

/** The class names a file writes in `className="…"`, or in the strings of a `className={…}`. */
function classNames(source: string): string[] {
  const literal = [...source.matchAll(/className="([^"]*)"/g)].map((match) => match[1]!);
  const computed = [...source.matchAll(/className=\{([^}]*)\}/g)].flatMap((match) => [...match[1]!.matchAll(/["'`]([^"'`]*)["'`]/g)].map((inner) => inner[1]!));
  return [...literal, ...computed].flatMap((names) => names.split(/\s+/)).filter(Boolean);
}

describe("the Agenda, Mon compte and Mon abonnement in the Design System (#469, ADR-0053)", () => {
  it("are found, every Section of Mon compte", () => {
    for (const page of ["agenda/page.tsx", "abonnement/page.tsx", "compte/(sections)/page.tsx", "compte/(sections)/rappels/page.tsx", "compte/(sections)/outils/page.tsx", "compte/(open-before-acceptance)/donnees/page.tsx"]) {
      expect(PAGES.some((file) => file.endsWith(page))).toBe(true);
    }
  });

  it.each(PAGES.map((file) => [file.slice(join(app, "..").length + 1), file]))("%s draws no old markup a component replaces", (_, file) => {
    const used = classNames(readFileSync(file, "utf8")).filter((name) => name in OLD_CLASSES);
    expect(used.map((name) => `${name} → ${OLD_CLASSES[name]}`)).toEqual([]);
  });

  it.each([join(app, "agenda/agenda.css"), join(app, "abonnement/abonnement.css"), join(app, "compte/account.css")].map((file) => [file.slice(join(app, "..").length + 1), file]))(
    "%s keeps its page's layout beside it, on the ADR-0009 floor and the tokens",
    (_, file) => {
      expect(auditStylesheet(readFileSync(file, "utf8"))).toEqual([]);
    },
  );
});
