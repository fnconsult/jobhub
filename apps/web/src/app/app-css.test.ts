import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditStylesheet } from "@jobhub/shared/design";

// The web app's one stylesheet (ADR-0018), held to the ADR-0009 floor like the prototype it follows (#132).
const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");

/** The selectors of the innermost rule blocks that set `font-size: var(--font-size-meta)`. */
function metadataSizeSelectors(source: string): string[] {
  const found: string[] = [];
  for (const block of source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/font-size\s*:\s*var\(--font-size-meta\)/i.test(block[2]!)) found.push(block[1]!.trim().replace(/\s+/g, " "));
  }
  return found;
}

/**
 * Where the page stylesheet sets the metadata size. ADR-0057: pills, small buttons, segmented options and field
 * errors stay at body size; only metadata lines and hints are small. The stylesheet audit reads no `var()` size,
 * so this list is the check: a new entry is a decision against ADR-0057, not a free style choice.
 */
const METADATA_SIZE_SELECTORS = [
  ".live-action-spent, .chat-stopped-spent", // the spend line under a finished action
  ".provenance-line", // where a value came from
  ".sidebar-count", // a count beside a sidebar link
  ".release-line", // « Version de Jobbbox » (#559)
  ".usage-meter-renews", // when the usage meter renews
  ".usage-meter-detail",
  ".signalement-tip", // a hint
  ".signalement-meta",
  ".cv-card-meta", // a Master CV card's version line and the full editor's hint (#468)
  ".cv-job-mark", // a job's employer initials, hidden from screen readers: a mark, not text (#468)
  ".ai-activity-summary",
  ".ai-activity-chips",
  ".ai-activity-meta, .ai-activity-measure",
  ".ai-activity-element-model code",
  ".chart-axis span", // chart axis labels
  ".chart-x",
  ".chart-threshold-label",
];

describe("the web app's stylesheet", () => {
  it("stays on the ADR-0009 floor: no type below 16px, text only in audited text colours, colours only as tokens", () => {
    expect(auditStylesheet(css)).toEqual([]);
  });

  it("sets the metadata size only on metadata lines, never on a pill or a label (ADR-0057)", () => {
    expect(metadataSizeSelectors(css)).toEqual(METADATA_SIZE_SELECTORS);
  });
});
