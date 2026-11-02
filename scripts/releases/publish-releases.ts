/**
 * Publishes a GitHub Release for every Version tag (ADR-0063, #561); `.github/workflows/publier-releases.yml` runs it
 * through `scripts/publish-releases.ts`. Every effect goes through `deps`, so the tests fake `gh` (and drive a real `git`).
 *
 * - A tag `vX.Y.Z` with its Release Note (`packages/help/releases/{fr,en}/X.Y.Z.md`, read from the tag itself): the
 *   Release says the French text, then the English, then the pull requests since the previous tag.
 * - A tag with no Release Note: a technical Release, « vX.Y.Z (technique) », with the list of pull requests alone.
 * - A Release Note with no tag (the next Version, on the Beta): nothing.
 * - A Release that already says what it should is left alone, so running it again creates no duplicate.
 * - A Release Note is never changed after its Promotion: when the checked-out tree's note of a tagged Version differs
 *   from the tag's, it publishes nothing and fails.
 */
import { parseFrontmatter } from "../../packages/help/src/content";

export const RELEASES_DIR = "packages/help/releases";
const LOCALES = ["fr", "en"] as const;
const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export type Deps = {
  /** Runs `git` or `gh` in the repo and returns its standard output, `input` on its standard input; throws when it fails. */
  run: (command: "git" | "gh", args: string[], input?: string) => string;
  log: (line: string) => void;
};

export type Options = {
  /** `owner/name`. */
  repo: string;
  /** Says what it would do, and writes nothing. */
  dryRun: boolean;
};

export type Release = { id: number; tag_name: string; name: string | null; body: string | null };
export type Wanted = { tag: string; name: string; body: string; technical: boolean };
export type Action = { kind: "create" | "update" | "unchanged"; wanted: Wanted; release?: Release };
export type Outcome = { problems: string[]; actions: Action[] };

/** The Version tags `vX.Y.Z`, oldest Version first. */
export function versionTags(tags: string[]): string[] {
  const parts = (tag: string) => VERSION_TAG.exec(tag)!.slice(1).map(Number);
  return tags
    .filter((tag) => VERSION_TAG.test(tag))
    .sort((a, b) => {
      const [x, y] = [parts(a), parts(b)];
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
    });
}

const notePath = (locale: string, version: string) => `${RELEASES_DIR}/${locale}/${version}.md`;

/** One language of a Release Note, as the Release shows it: its title as a heading, then its text. */
function noteSection(markdown: string): string {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  return `${title ? `# ${title}\n\n` : ""}${body.trim()}`;
}

/**
 * What the Release of `tag` must say. `notes` holds the Release Note in each language, as the tag carries it (null
 * when the tag has none); `pullRequests` is GitHub's generated list of what was merged since the previous tag.
 */
export function renderRelease(tag: string, notes: { fr: string | null; en: string | null }, pullRequests: string): Wanted {
  const list = pullRequests.trim() || "_Aucune pull request depuis la Version précédente. / No pull request since the previous Version._";
  if (!notes.fr && !notes.en) return { tag, name: `${tag} (technique)`, body: `${list}\n`, technical: true };
  const sections = LOCALES.map((locale) => notes[locale]).filter((note): note is string => Boolean(note)).map(noteSection);
  const title = parseFrontmatter(notes.fr ?? notes.en!).frontmatter.title;
  return {
    tag,
    name: typeof title === "string" && title ? `${tag} — ${title}` : tag,
    body: `${[...sections, list].join("\n\n---\n\n")}\n`,
    technical: false,
  };
}

const normalise = (text: string | null | undefined) => (text ?? "").replace(/\r\n/g, "\n").trim();

/** Whether `release` already says what `wanted` says. */
export function upToDate(release: Release, wanted: Wanted): boolean {
  return normalise(release.name) === normalise(wanted.name) && normalise(release.body) === normalise(wanted.body);
}

/** Tries `run`; null when it throws. */
function attempt<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

/**
 * The Release Notes of tagged Versions that the checked-out tree (`HEAD`) changed since their tag: added, edited or
 * removed. A published Release Note is never changed; a correction belongs to the next Version's.
 */
export function changedPublishedNotes(deps: Deps, tags: string[]): string[] {
  const git = (...args: string[]) => deps.run("git", args);
  const problems: string[] = [];
  for (const tag of tags) {
    const version = tag.slice(1);
    for (const locale of LOCALES) {
      const file = notePath(locale, version);
      const atTag = attempt(() => git("show", `${tag}:${file}`));
      const atHead = attempt(() => git("show", `HEAD:${file}`));
      if (atTag === atHead) continue;
      const what = atTag === null ? "a été ajoutée" : atHead === null ? "a été supprimée" : "a été modifiée";
      problems.push(`${file} ${what} après la Promotion de ${tag} : une Release Note publiée ne change plus (corrigez dans celle de la Version suivante).`);
    }
  }
  return problems;
}

/** Every Release of the repo, by tag. */
function releasesByTag(deps: Deps, repo: string): Map<string, Release> {
  const lines = deps.run("gh", ["api", "--paginate", `repos/${repo}/releases`, "--jq", ".[] | {id, tag_name, name, body}"]);
  const releases = lines
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Release);
  return new Map(releases.map((release) => [release.tag_name, release]));
}

/** GitHub's list of the pull requests merged between `previous` (or the start) and `tag`. */
function generatedNotes(deps: Deps, repo: string, tag: string, previous: string | undefined): string {
  const args = ["api", "-X", "POST", `repos/${repo}/releases/generate-notes`, "-f", `tag_name=${tag}`];
  if (previous) args.push("-f", `previous_tag_name=${previous}`);
  return (JSON.parse(deps.run("gh", args)) as { body?: string }).body ?? "";
}

export function publishReleases(deps: Deps, options: Options): Outcome {
  const tags = versionTags(deps.run("git", ["tag", "--list", "v*"]).split("\n").map((tag) => tag.trim()));

  const problems = changedPublishedNotes(deps, tags);
  if (problems.length) {
    for (const problem of problems) deps.log(`✗ ${problem}`);
    return { problems, actions: [] };
  }

  if (!tags.length) deps.log("Aucun tag de Version : rien à publier.");
  const existing = releasesByTag(deps, options.repo);
  const latest = tags.at(-1);
  const actions: Action[] = [];
  tags.forEach((tag, index) => {
    const version = tag.slice(1);
    const [fr, en] = LOCALES.map((locale) => attempt(() => deps.run("git", ["show", `${tag}:${notePath(locale, version)}`])));
    // GitHub generates the list only for a token that may write the repo's contents; a pull request's dry-run has none.
    const pullRequests = options.dryRun
      ? (attempt(() => generatedNotes(deps, options.repo, tag, tags[index - 1])) ?? "_(liste des pull requests non lue en dry-run)_")
      : generatedNotes(deps, options.repo, tag, tags[index - 1]);
    const wanted = renderRelease(tag, { fr: fr ?? null, en: en ?? null }, pullRequests);
    const release = existing.get(tag);
    const kind = !release ? "create" : upToDate(release, wanted) ? "unchanged" : "update";
    actions.push({ kind, wanted, release });

    const label = `${wanted.name}${wanted.technical ? "" : " (FR, EN, pull requests)"}`;
    if (kind === "unchanged") return deps.log(`= ${label} : déjà à jour`);
    deps.log(`${kind === "create" ? "+" : "~"} ${label} : ${kind === "create" ? "création" : "mise à jour"}${options.dryRun ? " (dry-run, rien n'est écrit)" : ""}`);
    if (options.dryRun) return;
    if (kind === "create") {
      // Only the newest Version is the latest Release: one published again for an older tag never takes its place.
      const payload = { tag_name: tag, name: wanted.name, body: wanted.body, draft: false, prerelease: false, make_latest: tag === latest ? "true" : "false" };
      deps.run("gh", ["api", "-X", "POST", `repos/${options.repo}/releases`, "--input", "-"], JSON.stringify(payload));
    } else {
      deps.run("gh", ["api", "-X", "PATCH", `repos/${options.repo}/releases/${release!.id}`, "--input", "-"], JSON.stringify({ name: wanted.name, body: wanted.body }));
    }
  });
  return { problems: [], actions };
}
