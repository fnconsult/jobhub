/**
 * Each Tool of Consumption is counted at exactly one place (#799): a recorder goes through the source of the web app
 * and the worker, lists every call of `countUse` with the Tool it counts, and every statement that saves a Tool's
 * result. A feature that saves its result without counting it, or a second place counting a Tool, fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { QUOTA_CONSUMPTION_TOOLS, consumptionTools, type ConsumptionTool } from "./index";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SOURCES = ["apps/web/src", "apps/worker/src"];

/**
 * The statement that marks each Tool's use: the Coach reply's insert, the Plan Quota use, the result row saved with its
 * Provenance. The file holding it is the one place that Tool is counted.
 */
const MARKS_THE_USE: Record<ConsumptionTool, RegExp> = {
  coach: /INSERT INTO coach_message \([^)]*\)\s*VALUES \(\$1, 'coach'/,
  jobSearch: /INSERT INTO quota_usage\b/,
  matchScore: /INSERT INTO quota_usage\b/,
  atsScore: /INSERT INTO quota_usage\b/,
  enrichedContact: /INSERT INTO quota_usage\b/,
  tailoredCv: /INSERT INTO tailored_cv\b/,
  tailoredDocument: /INSERT INTO tailored_document\b/,
  companyDossier: /INSERT INTO company_dossier\b/,
  cvReading: /INSERT INTO master_cv_version \([^)]*\bprovenance\b/,
};

interface Site {
  file: string;
  line: number;
  tools: ConsumptionTool[];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every call of `countUse` outside the Consumption module, with the Tools it counts: a key, or a Plan Quota's Tool. */
function recordSites(): { sites: Site[]; unread: string[] } {
  const sites: Site[] = [];
  const unread: string[] = [];
  for (const path of SOURCES.flatMap((source) => sourceFiles(join(ROOT, source)))) {
    const file = relative(ROOT, path);
    if (file.startsWith("apps/web/src/consumption/")) continue;
    const text = readFileSync(path, "utf8");
    for (const call of text.matchAll(/\bcountUse\(([^;]*?)\);/gs)) {
      const line = text.slice(0, call.index).split("\n").length;
      const tool = /^[^,]+,[^,]+,\s*(?:"(\w+)"|(QUOTA_CONSUMPTION_TOOLS\[))/s.exec(call[1]!);
      if (tool?.[1]) sites.push({ file, line, tools: [tool[1] as ConsumptionTool] });
      else if (tool?.[2]) sites.push({ file, line, tools: Object.values(QUOTA_CONSUMPTION_TOOLS) });
      else unread.push(`${file}:${line}`);
    }
  }
  return { sites, unread };
}

/** The files holding each Tool's statement that marks its use. */
function filesMarking(tool: ConsumptionTool): string[] {
  return SOURCES.flatMap((source) => sourceFiles(join(ROOT, source)))
    .filter((path) => MARKS_THE_USE[tool].test(readFileSync(path, "utf8")))
    .map((path) => relative(ROOT, path));
}

describe("each Tool of Consumption is counted at exactly one place (#799)", () => {
  const { sites, unread } = recordSites();

  it("every count names its Tool: a key, or the Tool of a Plan Quota", () => {
    expect(unread).toEqual([]);
  });

  it.each(consumptionTools())("%s is counted at one place, where its use is marked", (tool) => {
    const counting = sites.filter((site) => site.tools.includes(tool));
    expect(counting.map((site) => `${site.file}:${site.line}`)).toHaveLength(1);
    // The one file marking the use counts it: a feature saving the same result elsewhere, uncounted, fails here.
    expect(filesMarking(tool)).toEqual([counting[0]!.file]);
  });
});
