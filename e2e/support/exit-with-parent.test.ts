import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The chain web-server.mjs builds: a launcher that imports exit-with-parent.mjs and starts
// `npx … node` with exitWithParentEnv, piping its output, while the server keeps logging.
// Like next-server (next/dist/server/lib/router-server.js), the server logs uncaught errors
// instead of crashing: once its stdout has no reader, every log line is an EPIPE it logs again.
// Like web-server.mjs, the launcher does not crash on writing to a stdout nobody reads any more:
// were it to, that EPIPE, not its watchdog, would stop it once Playwright is killed, so the test
// would pass with no watchdog at all, and print the crash (« syscall: 'write' ») in `npm test`.
const repoRoot = path.resolve(import.meta.dirname, "../..");
const module = path.join(import.meta.dirname, "exit-with-parent.mjs");
const server = `
process.on("uncaughtException", (error) => console.error("uncaughtException: ", error));
console.log("pids " + process.ppid + " " + process.pid);
setInterval(() => console.log("GET /api/health 200"), 20);
`;
const launcher = (command: string[]) => `
import { spawn } from "node:child_process";
import { exitWithParentEnv } from ${JSON.stringify(module)};
process.stdout.on("error", () => {});
const server = spawn("npx", ["--no-install", ...${JSON.stringify(command)}], {
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

/** Running: a zombie (exited, not yet reaped by whoever adopted it, e.g. a subreaper on Linux) is not. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z";
  } catch {
    return true; // No /proc (macOS): its zombies are reaped by launchd at once.
  }
};

async function gone(pid: number, withinMs = 10_000) {
  const deadline = Date.now() + withinMs;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  return !alive(pid);
}

/** The launcher's pid, the server's and its parent's (npx, or a shell npx started), once the chain has printed them. */
function pidsOf(top: ChildProcess): Promise<{ launcher: number; parent: number; server: number }> {
  return new Promise((resolve, reject) => {
    let output = "";
    top.stdout!.on("data", (chunk) => {
      output += chunk;
      const launcherPid = /launcher (\d+)/.exec(output);
      const serverPids = /pids (\d+) (\d+)/.exec(output);
      if (launcherPid && serverPids) {
        resolve({ launcher: Number(launcherPid[1]), parent: Number(serverPids[1]), server: Number(serverPids[2]) });
      }
    });
    top.on("exit", (code) => reject(new Error(`exited (${code}) before printing its pids:\n${output}`)));
  });
}

// npm runs a package's binary itself on one machine and through `sh -c` on another (CI's Linux);
// a shell that waits for the server instead of exec'ing it has no watchdog of its own.
describe.each([
  { chain: "npx runs the server", command: (file: string) => ["node", file] },
  // `npx -c` runs its command through `sh -c`; `; exit $?` keeps the shell from exec'ing node.
  { chain: "npx runs a shell that runs the server", command: (file: string) => ["-c", `node ${JSON.stringify(file)}; exit $?`] },
])("exit-with-parent: the e2e web server's processes end with whoever started them ($chain)", ({ command }) => {
  let dir: string;
  let launcherFile: string;
  const started: number[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "exit-with-parent-"));
    const serverFile = path.join(dir, "server.cjs");
    writeFileSync(serverFile, server);
    launcherFile = path.join(dir, "launcher.mjs");
    writeFileSync(launcherFile, launcher(command(serverFile)));
  });
  afterEach(() => {
    // Never leave a process behind, whatever the verdict.
    for (const pid of started.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops the server and its parent when the launcher is killed outright", async () => {
    const top = spawn(process.execPath, [launcherFile], { stdio: ["ignore", "pipe", "inherit"] });
    const pids = await pidsOf(top);
    started.push(pids.launcher, pids.parent, pids.server);

    top.kill("SIGKILL");

    expect(await gone(pids.server)).toBe(true);
    expect(await gone(pids.parent)).toBe(true);
  }, 30_000);

  it("stops the launcher, the server and its parent when Playwright, which started the launcher, is killed outright", async () => {
    const top = spawn(process.execPath, ["-e", runner(launcherFile)], { stdio: ["ignore", "pipe", "inherit"] });
    const pids = await pidsOf(top);
    started.push(pids.launcher, pids.parent, pids.server);

    top.kill("SIGKILL");

    expect(await gone(pids.launcher)).toBe(true);
    expect(await gone(pids.server)).toBe(true);
    expect(await gone(pids.parent)).toBe(true);
  }, 30_000);
});

describe("exitWithParentEnv", () => {
  it("adds its preload to NODE_OPTIONS once, keeping the options already there, and names this process as the one to exit with", async () => {
    const { exitWithParentEnv } = await import("./exit-with-parent.mjs");
    const once = exitWithParentEnv({ NODE_OPTIONS: "--import=/fake-google.mjs", PATH: "/bin" });
    expect(once).toEqual({ NODE_OPTIONS: `--import=/fake-google.mjs --import=${module}`, PATH: "/bin", E2E_EXIT_WITH_PID: String(process.pid) });
    expect(exitWithParentEnv(once)).toEqual(once);
  });
});
