import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

/** The monorepo root: where the README tells developers to `cp .env.example .env`. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Loads `<rootDir>/.env` into `process.env`. Next.js only reads `.env*` files from
 * `apps/web`, so `next.config.ts` calls this for `next dev`, `next build` and `next start`.
 * Values already in `process.env` (shell, CI, container, `apps/web/.env*`) win.
 * A missing file is not an error: CI and containers inject the environment directly.
 */
export function loadRootEnv(rootDir: string = repoRoot): void {
  let contents: string;
  try {
    contents = readFileSync(path.join(rootDir, ".env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const [name, value] of Object.entries(parseEnv(contents))) {
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
}
