import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The chain web-server.mjs builds: a launcher that imports exit-with-parent.mjs and starts
// `npx … node` with exitWithParentEnv, piping its output, while the server keeps logging.
// Like next-server (next/dist/server/lib/router-server.js), the server logs uncaught errors
// instead of crashing: once its stdout has no reader, every log line is an EPIPE it logs again.
const repoRoot = path.resolve(import.meta.dirname, "../..");
const module = path.join(import.meta.dirname, "exit-with-parent.mjs");
const server = `
process.on("uncaughtException", (error) => console.error("uncaughtException: ", error));
console.log("pids " + process.ppid + " " + process.pid);
setInterval(() => console.log("GET /api/health 200"), 20);
`;
const launcher = `
import { spawn } from "node:child_process";
import { exitWithParentEnv } from ${JSON.stringify(module)};
const server = spawn("npx", ["--no-install", "node", "-e", ${JSON.stringify(server)}], {
  cwd: ${JSON.stringify(repoRoot)},
  env: exitWithParentEnv(process.env),
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => process.stdout.write(chunk));
console.log("launcher " + process.pid);
`;
// Plays Playwright: starts the launcher and reads its output, knowing nothing of exit-with-parent.mjs.
const runner = (launcherFile: string) => `
const { spawn } = require("node:child_process");
const launcher = spawn(process.execPath, [${JSON.stringify(launcherFile)}], { stdio: ["ignore", "pipe", "inherit"] });
launcher.stdout.on("data", (chunk) => process.stdout.write(chunk));
`;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

async function gone(pid: number, withinMs = 10_000) {
  const deadline = Date.now() + withinMs;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  return !alive(pid);
}

/** Every pid the chain prints, once it has printed the launcher's and the server's. */
function pidsOf(top: ChildProcess): Promise<{ launcher: number; npx: number; server: number }> {
  return new Promise((resolve, reject) => {
    let output = "";
    top.stdout!.on("data", (chunk) => {
      output += chunk;
      const launcherPid = /launcher (\d+)/.exec(output);
      const serverPids = /pids (\d+) (\d+)/.exec(output);
      if (launcherPid && serverPids) {
        resolve({ launcher: Number(launcherPid[1]), npx: Number(serverPids[1]), server: Number(serverPids[2]) });
      }
    });
    top.on("exit", (code) => reject(new Error(`exited (${code}) before printing its pids:\n${output}`)));
  });
}

describe("exit-with-parent: the e2e web server's processes end with whoever started them", () => {
  let dir: string;
  let launcherFile: string;
  const started: number[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "exit-with-parent-"));
    launcherFile = path.join(dir, "launcher.mjs");
    writeFileSync(launcherFile, launcher);
  });
  afterEach(() => {
    // Never leave a process behind, whatever the verdict.
    for (const pid of started.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops npx and the server when the launcher is killed outright", async () => {
    const top = spawn(process.execPath, [launcherFile], { stdio: ["ignore", "pipe", "inherit"] });
    const pids = await pidsOf(top);
    started.push(pids.launcher, pids.npx, pids.server);

    top.kill("SIGKILL");

    expect(await gone(pids.npx)).toBe(true);
    expect(await gone(pids.server)).toBe(true);
  }, 30_000);

  it("stops the launcher, npx and the server when Playwright, which started the launcher, is killed outright", async () => {
    const top = spawn(process.execPath, ["-e", runner(launcherFile)], { stdio: ["ignore", "pipe", "inherit"] });
    const pids = await pidsOf(top);
    started.push(pids.launcher, pids.npx, pids.server);

    top.kill("SIGKILL");

    expect(await gone(pids.launcher)).toBe(true);
    expect(await gone(pids.npx)).toBe(true);
    expect(await gone(pids.server)).toBe(true);
  }, 30_000);

  it("adds its preload to NODE_OPTIONS once, keeping the options already there", async () => {
    const { exitWithParentEnv } = await import("./exit-with-parent.mjs");
    const once = exitWithParentEnv({ NODE_OPTIONS: "--import=/fake-google.mjs", PATH: "/bin" });
    expect(once).toEqual({ NODE_OPTIONS: `--import=/fake-google.mjs --import=${module}`, PATH: "/bin" });
    expect(exitWithParentEnv(once)).toEqual(once);
  });
});
