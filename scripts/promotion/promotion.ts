/**
 * The Promotion (ADR-0063, #560): the product owner turns what the Beta serves into a Version in Production.
 * `scripts/promote.ts` runs it; every effect goes through `deps`, so the tests fake `git`, `gh` and `fetch`.
 * Its messages are in French: only the product owner reads them. No agent may Promote (scripts/hooks/no-promotion.mjs).
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VERSIONED_MANIFESTS, versionMismatches } from "../../apps/web/src/release/versions";

export type Bump = "patch" | "minor" | "major";

export type Options = {
  /** The product owner's « rien de visible pour un Candidat »: no Release Note is required. */
  nothingVisible: boolean;
  /** How the Version after this one is numbered on `main`. */
  bump: Bump;
  /** Skips the typed confirmation. */
  yes: boolean;
  remote: string;
  betaUrl: string;
  productionUrl: string;
};

export const DEFAULT_OPTIONS: Options = {
  nothingVisible: false,
  bump: "patch",
  yes: false,
  remote: "origin",
  betaUrl: "https://staging.jobbbox.ai",
  productionUrl: "https://jobbbox.ai",
};

export type Deps = {
  /** Runs `git` or `gh` in `cwd` (the repo by default) and returns its standard output; throws when it fails. */
  run: (command: "git" | "gh", args: string[], cwd?: string) => string;
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  log: (line: string) => void;
  ask: (question: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** A new empty directory for the next Version's worktree. */
  tempDir: () => string;
};

export type Outcome =
  | { promoted: false; problems: string[] }
  | { promoted: true; version: string; commit: string; pullRequest: string | null; problems: string[] };

const RELEASES = "packages/help/releases";
const UNRELEASED = `${RELEASES}/unreleased/`;
/** The lockfile entries that repeat the Version, besides its top-level `version`. */
const LOCKED_PACKAGES = ["", "apps/web", "apps/worker"];

/** The Version after `version`: `X.Y.(Z+1)` by default, `X.(Y+1).0` with --minor, `(X+1).0.0` with --major. */
export function nextVersion(version: string, bump: Bump): string {
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The command line's options; throws on one it does not know. */
export function parseArguments(args: string[]): Options {
  const options = { ...DEFAULT_OPTIONS };
  for (const arg of args) {
    if (arg === "--rien-de-visible") options.nothingVisible = true;
    else if (arg === "--minor" || arg === "--major") options.bump = arg.slice(2) as Bump;
    else if (arg === "--yes") options.yes = true;
    else throw new Error(`option inconnue : ${arg} (options : --rien-de-visible, --minor, --major, --yes)`);
  }
  return options;
}

const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "aucun");

/** Tries `run`; null when it throws. */
function attempt<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

/** What `/api/health` of `base` answers (#559), or why it could not be read. */
async function health(deps: Deps, base: string): Promise<{ version?: unknown; commit?: unknown } | string> {
  try {
    const response = await deps.fetch(`${base}/api/health`);
    if (!response.ok) return `${base}/api/health répond ${response.status}`;
    return (await response.json()) as { version?: unknown; commit?: unknown };
  } catch (error) {
    return `${base}/api/health est injoignable (${(error as Error).message})`;
  }
}

/** The preconditions of promoting `sha`, each `[what was checked, problem or null]`. */
async function preconditions(deps: Deps, options: Options, sha: string): Promise<{ version: string | null; checks: [string, string | null][] }> {
  const git = (...args: string[]) => deps.run("git", args);
  const checks: [string, string | null][] = [];

  const versions = Object.fromEntries(
    VERSIONED_MANIFESTS.map((file) => [file, attempt(() => (JSON.parse(git("show", `${sha}:${file}`)) as { version?: unknown }).version)]),
  ) as Parameters<typeof versionMismatches>[0];
  const mismatches = versionMismatches(versions);
  const version = mismatches.length === 0 ? String(versions["package.json"]) : null;
  checks.push(["Les versions concordent", mismatches.length ? mismatches.join(" ; ") : null]);
  if (!version) return { version, checks };

  const tag = `v${version}`;
  checks.push([`Le tag ${tag} n'existe pas encore`, attempt(() => git("rev-parse", "--quiet", "--verify", `refs/tags/${tag}`)) ? `le tag ${tag} existe déjà : la Version ${version} est déjà promue` : null]);

  const prod = attempt(() => git("rev-parse", "--quiet", "--verify", `refs/remotes/${options.remote}/prod`));
  const fastForward = !prod || attempt(() => git("merge-base", "--is-ancestor", prod, sha)) !== null;
  checks.push(["La branche prod avance sans réécriture", fastForward ? null : `prod (${short(prod)}) n'est pas un ancêtre de ${short(sha)}`]);

  const runs = attempt(() => JSON.parse(deps.run("gh", ["run", "list", "--workflow", "ci.yml", "--commit", sha, "--json", "status,conclusion"])) as { status: string; conclusion: string }[]);
  const ci =
    runs === null
      ? "la CI de ce commit n'a pas pu être lue (gh run list)"
      : runs.some((run) => run.conclusion === "success")
        ? null
        : runs.some((run) => run.status !== "completed")
          ? `la CI de ${short(sha)} tourne encore`
          : `la CI de ${short(sha)} n'est pas verte`;
  checks.push([`La CI de ${short(sha)} est verte`, ci]);

  const beta = await health(deps, options.betaUrl);
  checks.push([
    `La Beta sert ${short(sha)}`,
    typeof beta === "string"
      ? beta
      : beta.commit !== sha
        ? `la Beta sert ${short(typeof beta.commit === "string" ? beta.commit : null)}, pas ${short(sha)} : déployez ce commit sur la Beta`
        : beta.version !== version
          ? `la Beta sert la Version ${String(beta.version)}, pas ${version}`
          : null,
  ]);

  if (options.nothingVisible) checks.push(["Rien de visible pour un Candidat : pas de Release Note exigée", null]);
  else {
    const missing = ["fr", "en"].filter((lang) => attempt(() => git("cat-file", "-e", `${sha}:${RELEASES}/${lang}/${version}.md`)) === null);
    checks.push([
      `Les Release Notes FR et EN de ${version} existent`,
      missing.length
        ? `${missing.map((lang) => `${RELEASES}/${lang}/${version}.md`).join(" et ")} manque${missing.length > 1 ? "nt" : ""} (ou passez --rien-de-visible si rien n'est visible pour un Candidat)`
        : null,
    ]);
  }

  const fragments = (attempt(() => git("ls-tree", "--name-only", sha, UNRELEASED)) ?? "").split("\n").filter((file) => file.endsWith(".md"));
  checks.push([
    `Aucun fragment dans ${UNRELEASED}`,
    fragments.length ? `${fragments.length} fragment${fragments.length > 1 ? "s restent" : " reste"} dans ${UNRELEASED} (${fragments.map((file) => path.basename(file)).join(", ")}) : assemblez-les dans la Release Note` : null,
  ]);
  return { version, checks };
}

/** Sets the Version of the repo checked out in `dir` to `version`: the three manifests and the lockfile. */
export function writeVersion(dir: string, version: string): void {
  const rewrite = (file: string, change: (json: Record<string, unknown>) => void) => {
    const json = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
    change(json);
    writeFileSync(path.join(dir, file), `${JSON.stringify(json, null, 2)}\n`);
  };
  for (const file of VERSIONED_MANIFESTS) rewrite(file, (json) => void (json.version = version));
  rewrite("package-lock.json", (json) => {
    json.version = version;
    const packages = json.packages as Record<string, { version?: string }> | undefined;
    for (const name of LOCKED_PACKAGES) if (packages?.[name]) packages[name].version = version;
  });
}

/** The Deploy run the Promotion just started on `tag`, waiting for it to appear. */
async function deployRun(deps: Deps, tag: string, since: Date): Promise<{ databaseId: number; url: string } | null> {
  for (let tries = 0; tries < 24; tries++) {
    const runs = attempt(
      () =>
        JSON.parse(deps.run("gh", ["run", "list", "--workflow", "deploy.yml", "--branch", tag, "--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,createdAt,url"])) as {
          databaseId: number;
          createdAt: string;
          url: string;
        }[],
    );
    // GitHub's clock and this machine's may differ by a few seconds.
    const run = runs?.find((candidate) => new Date(candidate.createdAt).getTime() >= since.getTime() - 60_000);
    if (run) return run;
    await deps.sleep(5_000);
  }
  return null;
}

/** Opens the pull request that moves `main` to the Version after `version`; returns its URL. */
function openNextVersion(deps: Deps, options: Options, version: string): string {
  const next = nextVersion(version, options.bump);
  const branch = `version-${next}`;
  const dir = deps.tempDir();
  const git = (...args: string[]) => deps.run("git", args);
  git("fetch", "--quiet", options.remote, "main");
  git("worktree", "add", "--quiet", "-b", branch, dir, `${options.remote}/main`);
  let opened = false;
  try {
    writeVersion(dir, next);
    deps.run("git", ["commit", "--quiet", "-am", `Version suivante : ${next}`], dir);
    deps.run("git", ["push", "--quiet", "-u", options.remote, branch], dir);
    const body = [
      `La Version ${version} est promue (tag \`v${version}\`). \`main\` porte désormais la suivante, ${next}, que la Beta affiche « ${next} (main·sha) » (ADR-0063).`,
      "",
      "Ouverte par `scripts/promote.ts`.",
    ].join("\n");
    const url = deps.run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `Version suivante : ${next}`, "--body", body], dir).trim();
    opened = true;
    return url;
  } finally {
    attempt(() => git("worktree", "remove", "--force", dir));
    // A failed attempt leaves no local branch behind, so the step can be run again.
    if (!opened) attempt(() => git("branch", "--quiet", "-D", branch));
  }
}

/** Promotes what `main` carries: checks every precondition, and pushes nothing unless all hold. */
export async function promote(deps: Deps, options: Options): Promise<Outcome> {
  const git = (...args: string[]) => deps.run("git", args);
  const fail = (...problems: string[]): Outcome => {
    for (const problem of problems) deps.log(`✗ ${problem}`);
    return { promoted: false, problems };
  };

  try {
    git("fetch", "--quiet", "--tags", options.remote);
  } catch (error) {
    return fail(`git fetch ${options.remote} a échoué (${(error as Error).message.split("\n")[0]}). Rien n'a été poussé.`);
  }
  const sha = attempt(() => git("rev-parse", `${options.remote}/main^{commit}`).trim());
  if (!sha) return fail(`${options.remote}/main est introuvable. Rien n'a été poussé.`);

  deps.log(`Promotion de ${options.remote}/main (${short(sha)})`);
  const { version, checks } = await preconditions(deps, options, sha);
  for (const [what, problem] of checks) deps.log(problem ? `✗ ${what} : ${problem}` : `✓ ${what}`);
  const problems = checks.flatMap(([, problem]) => (problem ? [problem] : []));
  if (problems.length || !version) {
    deps.log("Une précondition manque : rien n'a été poussé.");
    return { promoted: false, problems };
  }

  const tag = `v${version}`;
  deps.log("");
  deps.log(`La Promotion va : créer le tag ${tag} sur ${short(sha)}, pousser prod et ${tag} ensemble (--atomic), déployer la Production depuis ${tag}, puis ouvrir la PR de la Version ${nextVersion(version, options.bump)}.`);
  if (options.nothingVisible) deps.log(`Rappel : vous avez déclaré « rien de visible pour un Candidat » : la Version ${version} n'aura pas de Release Note.`);
  if (!options.yes && (await deps.ask(`Tapez ${version} pour promouvoir : `)).trim() !== version) return fail("Promotion annulée. Rien n'a été poussé.");

  git("tag", "--annotate", tag, sha, "--message", `Version ${version}`);
  try {
    git("push", "--atomic", options.remote, `${sha}:refs/heads/prod`, `refs/tags/${tag}`);
  } catch (error) {
    attempt(() => git("tag", "--delete", tag));
    return fail(`le push de prod et ${tag} a été refusé (${(error as Error).message.split("\n")[0]}). Rien n'a été poussé.`);
  }
  deps.log(`✓ prod et ${tag} poussés sur ${short(sha)}`);

  const pushed = (problem: string): Outcome => {
    deps.log(`✗ ${problem}`);
    deps.log(`prod et ${tag} sont poussés. Relancez le déploiement : gh workflow run deploy.yml --ref ${tag} -f target=production -f confirm=jobbbox.ai, ou revenez en arrière en redéployant le tag précédent (docs/ops/promotion.md). La PR de la Version suivante n'est pas ouverte.`);
    return { promoted: true, version, commit: sha, pullRequest: null, problems: [problem] };
  };

  const since = deps.now();
  try {
    deps.run("gh", ["workflow", "run", "deploy.yml", "--ref", tag, "-f", "target=production", "-f", "confirm=jobbbox.ai"]);
  } catch (error) {
    return pushed(`le déploiement de la Production n'a pas pu être lancé (${(error as Error).message.split("\n")[0]})`);
  }
  const run = await deployRun(deps, tag, since);
  if (!run) return pushed(`le déploiement de ${tag} n'apparaît pas dans gh run list`);
  deps.log(`… déploiement de la Production : ${run.url}`);
  try {
    deps.run("gh", ["run", "watch", String(run.databaseId), "--exit-status", "--interval", "15"]);
  } catch {
    return pushed(`le déploiement de la Production a échoué : ${run.url}`);
  }

  const production = await health(deps, options.productionUrl);
  if (typeof production === "string") return pushed(production);
  if (production.version !== version || production.commit !== sha)
    return pushed(`la Production sert ${String(production.version)} (${short(typeof production.commit === "string" ? production.commit : null)}), pas ${version} (${short(sha)})`);
  deps.log(`✓ la Production sert ${version} (${short(sha)})`);

  try {
    const pullRequest = openNextVersion(deps, options, version);
    deps.log(`✓ PR de la Version suivante : ${pullRequest}`);
    return { promoted: true, version, commit: sha, pullRequest, problems: [] };
  } catch (error) {
    const problem = `la PR de la Version suivante n'a pas pu être ouverte (${(error as Error).message.split("\n")[0]})`;
    deps.log(`✗ ${problem}. La Version ${version} est en Production ; montez main à la main.`);
    return { promoted: true, version, commit: sha, pullRequest: null, problems: [problem] };
  }
}

/** A new empty directory under the system's temporary directory. */
export const newTempDir = () => mkdtempSync(path.join(tmpdir(), "jobhub-promotion-"));
