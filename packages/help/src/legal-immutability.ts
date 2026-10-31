/**
 * A Legal Text Version is never edited once in effect (ADR-0062): a correction is a new version. CI runs this check on
 * every pull request (`scripts/check-legal-immutability.ts`): it fails when the pull request changes, deletes or
 * renames a file of `packages/help/legal/` whose effective date is reached, or adds one that would take effect in the
 * past. Node only (runs git): never imported by `index.ts`.
 */
import { execFileSync } from "node:child_process";

/** The folder the Legal Text Versions live in, from the repo's root. */
export const LEGAL_PATH = "packages/help/legal/";

/** One file a pull request changes, as `git diff --name-status` says: added, modified, deleted, or renamed `from`. */
export interface LegalChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  from?: string;
}

const VERSION_PATH = /^packages\/help\/legal\/[^/]+\/(\d{4}-\d{2}-\d{2})\.[a-z]+\.md$/;

/** What is wrong with `changes` on `today` (`YYYY-MM-DD`, in France): one line per refused file; none when it may merge. */
export function legalImmutabilityViolations(changes: readonly LegalChange[], today: string): string[] {
  const effective = (file: string) => VERSION_PATH.exec(file)?.[1];
  const inEffect = (file: string, how: string) => {
    const day = effective(file);
    return day && day <= today ? [`${file} is ${how}, but it took effect on ${day}: a correction is a new version`] : [];
  };
  return changes.flatMap((change) => {
    if (change.status === "M") return inEffect(change.path, "changed");
    if (change.status === "D") return inEffect(change.path, "deleted");
    const added = effective(change.path);
    return [
      ...(change.from ? inEffect(change.from, "deleted") : []),
      ...(added && added < today ? [`${change.path} is added, but its effective date ${added} is past: a new version takes effect today at the earliest`] : []),
    ];
  });
}

/** The files of `packages/help/legal/` changed between `base` and HEAD, in the git repo at `cwd`. */
export function legalChangesSince(base: string, cwd: string = process.cwd()): LegalChange[] {
  const output = execFileSync("git", ["diff", "--name-status", "--find-renames", base, "HEAD", "--", LEGAL_PATH], { cwd, encoding: "utf8" });
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split("\t") as [string, string, string | undefined];
      // A copy or a type change is read as an addition or a change of its path.
      if (status.startsWith("R")) return { status: "R", path: second!, from: first };
      if (status.startsWith("C")) return { status: "A", path: second! };
      return { status: status === "T" ? "M" : (status as LegalChange["status"]), path: first };
    });
}
