import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { expect, test } from "@playwright/test";

// The two local dev servers, started through their public commands from the README:
// `npm run dev` (the web app, Next.js) and `npm run dev -w @jobhub/extension` (WXT).
// The web app must keep its port whichever starts first (#71).
//
// The web app's port is 3000. WXT, left to itself, prefers 3000 too and falls back to
// 3001–3010: the first free one of those is the port the two would fight over. On a
// clean machine that is 3000; when 3000 is already taken (another checkout's dev
// server), it is the next free one, and the web app is pointed at it with PORT, the
// variable `next dev` reads, so the race is the same one.

const EXTENSION_DEV_PORT = 3100;

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

/** The port WXT would take with no port of its own: 3000, else the first free one up to 3010. */
async function contestedPort(): Promise<number> {
  for (let port = 3000; port <= 3010; port++) if (await isFree(port)) return port;
  throw new Error("Ports 3000–3010 are all taken: nothing for the two dev servers to contest.");
}

type DevServer = { proc: ChildProcess; output: () => string };

function start(args: string[], env: NodeJS.ProcessEnv): DevServer {
  // Its own process group, so npm, its shell and the server underneath all stop together.
  const proc = spawn("npm", args, { env: { ...process.env, ...env, CI: "1" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout!.on("data", (chunk) => (out += chunk));
  proc.stderr!.on("data", (chunk) => (out += chunk));
  return { proc, output: () => stripVTControlCharacters(out) };
}

async function stop(server: DevServer | undefined) {
  if (!server?.proc.pid || server.proc.exitCode !== null) return;
  const exited = new Promise((resolve) => server.proc.once("exit", resolve));
  try {
    process.kill(-server.proc.pid, "SIGTERM");
  } catch {
    return;
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
  try {
    process.kill(-server.proc.pid, "SIGKILL");
  } catch {
    // already gone
  }
}

async function waitFor(server: DevServer, pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = server.output().match(pattern);
    if (match) return match;
    if (server.proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} never reported ${pattern}. Output:\n${server.output()}`);
}

let home: string;
const servers: DevServer[] = [];

/** The extension's dev server, without the Chrome dev profile it would open (`disabled` in a ~/.webextrc). */
async function startExtension(): Promise<{ server: DevServer; port: number }> {
  const server = start(["run", "dev", "-w", "@jobhub/extension"], { HOME: home });
  servers.push(server);
  const [, port] = await waitFor(server, /Started dev server @ http:\/\/localhost:(\d+)/, "The extension's dev server");
  return { server, port: Number(port) };
}

/** The web app's dev server, ready once it has answered a request. */
async function startWebApp(port: number): Promise<{ server: DevServer; port: number }> {
  const server = start(["run", "dev"], { PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" });
  servers.push(server);
  const [, local] = await waitFor(server, /Local:\s+http:\/\/localhost:(\d+)/, "The web app's dev server");
  return { server, port: Number(local) };
}

/** What answers on `port`: the web app's health check proves Next.js holds it, not WXT. */
async function webAppHealth(port: number, waitMs = 120_000): Promise<unknown> {
  const deadline = Date.now() + waitMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

test.describe("local dev servers (#71)", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "jobhub-dev-servers-"));
    writeFileSync(path.join(home, ".webextrc"), "disabled=true\n");
  });

  test.afterEach(async () => {
    await Promise.all(servers.splice(0).map(stop));
    rmSync(home, { recursive: true, force: true });
  });

  test("extension dev server first, then the web app: the web app still gets its port", async () => {
    const webPort = await contestedPort();

    const extension = await startExtension();
    expect(extension.port).toBe(EXTENSION_DEV_PORT);

    const web = await startWebApp(webPort);
    expect(web.port).toBe(webPort);
    expect(await webAppHealth(webPort)).toEqual({ status: "ok" });
    expect(await webAppHealth(EXTENSION_DEV_PORT, 2_000)).not.toEqual({ status: "ok" });
  });

  test("web app first, then the extension dev server: the same ports", async () => {
    const webPort = await contestedPort();

    const web = await startWebApp(webPort);
    expect(web.port).toBe(webPort);
    expect(await webAppHealth(webPort)).toEqual({ status: "ok" });

    const extension = await startExtension();
    expect(extension.port).toBe(EXTENSION_DEV_PORT);
    expect(await webAppHealth(webPort)).toEqual({ status: "ok" });
  });

  test("the README's dev section gives the extension dev server's port", async () => {
    const { port } = await startExtension();

    const readme = readFileSync("README.md", "utf8");
    const devSection = readme.slice(readme.indexOf("npm run dev"));
    const extensionLine = devSection.split("\n").find((line) => line.includes("npm run dev -w @jobhub/extension"));
    expect(extensionLine).toContain(`http://localhost:${port}`);
  });
});
