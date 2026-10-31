import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parisDay } from "./support/paris-days";

// Issue #547 (ADR-0062): a substantial Legal Text Version is emailed to Candidates 30 days before it takes effect, so
// CI refuses one merged less than 30 days before its effective date, and says the first possible date. Driven through
// CI's own entry point, packages/help/scripts/check-legal-immutability.ts, on a throwaway git repository.
const script = path.resolve("packages/help/scripts/check-legal-immutability.ts");

const version = (change: "substantielle" | "mineure") => `---\ntitle: Conditions générales d'utilisation\nchange: ${change}\n---\n## Objet\nTexte.\n`;

/** The check on a pull request adding `files` (path under packages/help/legal/ → contents) to a repository with none. */
function checkAdding(files: Record<string, string>) {
  const repo = mkdtempSync(path.join(tmpdir(), "legal-notice-ci-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  };
  try {
    git("init", "-q");
    writeFileSync(path.join(repo, "README.md"), "Jobbbox\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    for (const [file, contents] of Object.entries(files)) {
      const full = path.join(repo, "packages/help/legal", file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    git("add", "-A");
    git("commit", "-qm", "adds versions");
    return spawnSync("npx", ["tsx", script, "HEAD^1"], { cwd: repo, encoding: "utf8" });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test.describe("The 30 days of notice, checked by CI (#547)", () => {
  test.describe.configure({ timeout: 60_000 });

  test("a substantial version of the CGU effective in 20 days is refused, with the first possible date", () => {
    const soon = parisDay(20);
    const refused = checkAdding({ [`cgu/${soon}.fr.md`]: version("substantielle") });

    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stderr).toContain(`cgu/${soon}.fr.md is a substantial change effective on ${soon}`);
    expect(refused.stderr).toContain(`it takes effect on ${parisDay(30)} at the earliest`);
  });

  test("a substantial version 31 days ahead, and a minor one in 20 days, are let through", () => {
    const allowed = checkAdding({ [`cgu/${parisDay(31)}.fr.md`]: version("substantielle"), [`cgv/${parisDay(20)}.fr.md`]: version("mineure") });

    expect(allowed.status, allowed.stdout + allowed.stderr).toBe(0);
  });
});
