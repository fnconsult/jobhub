/**
 * Which motions a run of the `motions` workflow renders: those flagged « Motion à régénérer : <script> » in the pull
 * requests merged since the last Version (docs/agents/documentation.md, #508), plus any whose script changed since it
 * was published; or all of them; or the ones named.
 *
 *   flaggedScripts(["…\nMotion à régénérer : retrouver-candidature\n…"]); // ["retrouver-candidature"]
 */
import { HELP_LOCALES, type HelpLocale, type MotionScript } from "@jobhub/help";
import type { Manifest } from "./bucket";

export interface PlannedMotion {
  id: string;
  locale: HelpLocale;
  hash: string;
  /** The folder of its Motion Scripts (`packages/help/motions`, or the test fixtures). */
  scriptsDir: string;
  reason: "flagged" | "changed" | "new" | "all" | "named";
}

/** The scripts the « Motion à régénérer : <script> » lines of these pull request bodies name. */
export function flaggedScripts(bodies: readonly (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const body of bodies)
    for (const match of (body ?? "").matchAll(/Motion à régénérer\s*:\s*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?/gi)) found.add(match[1]!.toLowerCase());
  return [...found];
}

/**
 * The motions to render. `request` is « flagged », « all », or ids separated by commas. Throws on an id that names
 * no script.
 */
export function selectMotions(options: {
  request: string;
  scripts: Record<HelpLocale, readonly MotionScript[]>;
  scriptsDir: string;
  flagged: readonly string[];
  manifest: Manifest;
}): PlannedMotion[] {
  const { request, scripts, scriptsDir, flagged, manifest } = options;
  const ids = scripts.fr.map((script) => script.id);
  const named = request === "flagged" || request === "all" ? [] : request.split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = named.filter((id) => !ids.includes(id));
  if (unknown.length > 0) throw new Error(`no Motion Script named ${unknown.join(", ")} (known: ${ids.join(", ") || "none"})`);
  return HELP_LOCALES.flatMap((locale) =>
    scripts[locale].flatMap((script): PlannedMotion[] => {
      const published = manifest.motions[script.id]?.[locale];
      const reason: PlannedMotion["reason"] | null =
        request === "all"
          ? "all"
          : named.length > 0
            ? named.includes(script.id)
              ? "named"
              : null
            : flagged.includes(script.id)
              ? "flagged"
              : !published
                ? "new"
                : published.hash !== script.hash
                  ? "changed"
                  : null;
      return reason ? [{ id: script.id, locale, hash: script.hash, scriptsDir, reason }] : [];
    }),
  );
}

/** The bodies of the pull requests merged into `base` since `since` (ISO), from GitHub's REST API, newest first. */
export async function mergedPullBodies(options: { repo: string; token?: string; since: string | null; base?: string; fetcher?: typeof fetch }): Promise<string[]> {
  const { repo, token, since, base = "main", fetcher = fetch } = options;
  const bodies: string[] = [];
  // `git log --format=%cI` gives an offset (+02:00), GitHub gives UTC (Z): compared as instants, never as text.
  const from = since ? Date.parse(since) : null;
  if (from !== null && Number.isNaN(from)) throw new Error(`--since ${since} is no date`);
  for (let page = 1; page <= 10; page++) {
    const response = await fetcher(`https://api.github.com/repos/${repo}/pulls?state=closed&base=${base}&sort=updated&direction=desc&per_page=100&page=${page}`, {
      headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} listing the pull requests`);
    const pulls = (await response.json()) as { merged_at: string | null; updated_at: string; body: string | null }[];
    for (const pull of pulls) if (pull.merged_at && (from === null || Date.parse(pull.merged_at) >= from)) bodies.push(pull.body ?? "");
    // Sorted by update: once a page ends before `since`, older merges cannot follow.
    if (pulls.length < 100 || (from !== null && Date.parse(pulls.at(-1)!.updated_at) < from)) break;
  }
  return bodies;
}
