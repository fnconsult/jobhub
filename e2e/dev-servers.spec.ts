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
//
// The extension's own port, 3100, can be held too: by another checkout's extension dev
// server. WXT then refuses to start (strictPort), so the race tests give it the next free
// port with `--port`, and the README test reads the port from that refusal.

const EXTENSION_DEV_PORT = 3100;

function canListen(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * Free for both servers: the wildcard address (`next dev`) and localhost (WXT's Vite). A server
 * bound to localhost only ([::1]) leaves the wildcard bindable on macOS, so one probe is not enough.
 */
async function isFree(port: number): Promise<boolean> {
  return (await canListen(port)) && (await canListen(port, "localhost"));
}

/** The extension dev server's port: its own, 3100, unless another checkout holds it. */
async function extensionPort(): Promise<number> {
  for (let port = EXTENSION_DEV_PORT; port < EXTENSION_DEV_PORT + 100; port++) if (await isFree(port)) return port;
  throw new Error(`Ports ${EXTENSION_DEV_PORT}–${EXTENSION_DEV_PORT + 99} are all taken: nowhere for the extension's dev server.`);
}

/** The port WXT would take with no port of its own: 3000, else the first free one up to 3010. */
async function contestedPort(): Promise<number> {
  for (let port = 3000; port <= 3010; port++) if (await isFree(port)) return port;
  throw new Error("Ports 3000–3010 are all taken: nothing for the two dev servers to contest.");
}

type DevServer = { proc: ChildProcess; output: () => string; closed: () => boolean };

function start(args: string[], env: NodeJS.ProcessEnv): DevServer {
  // Its own process group, so npm, its shell and the server underneath all stop together.
  const proc = spawn("npm", args, { env: { ...process.env, ...env, CI: "1" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout!.on("data", (chunk) => (out += chunk));
  proc.stderr!.on("data", (chunk) => (out += chunk));
  // "close" comes after the last output, unlike "exit": a server that refuses to start has said why by then.
  let closed = false;
  proc.once("close", () => (closed = true));
  return { proc, output: () => stripVTControlCharacters(out), closed: () => closed };
}

/** Whether any process of the group `pgid` is still alive. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

async function groupGone(pgid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (groupAlive(pgid)) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

/**
 * Stops the whole group and waits until none of it is left. npm exits on SIGTERM at once, but the server underneath
 * may not: Vite's dev server closes itself first, and holds its port until it has. The next test must not find it there.
 */
async function stop(server: DevServer | undefined) {
  const pgid = server?.proc.pid;
  if (!pgid || !groupAlive(pgid)) return;
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {
    return;
  }
  if (await groupGone(pgid, 10_000)) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    return;
  }
  await groupGone(pgid, 10_000);
}

async function waitFor(server: DevServer, pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const match = server.output().match(pattern);
    if (match) return match;
    if (server.closed()) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const match = server.output().match(pattern);
  if (match) return match;
  throw new Error(`${what} never reported ${pattern}. Output:\n${server.output()}`);
}

let home: string;
const servers: DevServer[] = [];

/**
 * The extension's dev server, without the Chrome dev profile it would open (`disabled` in a ~/.webextrc),
 * on `port` when it is not its own (WXT's `--port`).
 */
function spawnExtension(port = EXTENSION_DEV_PORT): DevServer {
  const portArgs = port === EXTENSION_DEV_PORT ? [] : ["--", "--port", String(port)];
  const server = start(["run", "dev", "-w", "@jobhub/extension", ...portArgs], { HOME: home });
  servers.push(server);
  return server;
}

async function startExtension(port?: number): Promise<{ server: DevServer; port: number }> {
  const server = spawnExtension(port);
  const [, started] = await waitFor(server, /Started dev server @ http:\/\/localhost:(\d+)/, "The extension's dev server");
  return { server, port: Number(started) };
}

/**
 * Holds `port` on localhost, as another checkout's extension dev server would, unless something already does for good.
 * A server still closing (a previous test's) lets go of it a moment later, before the one under test binds: wait it out
 * and hold the port ourselves, so it is taken when the extension's dev server starts.
 */
async function holdPort(port: number): Promise<() => Promise<void>> {
  const deadline = Date.now() + 15_000;
  while (!(await canListen(port, "localhost"))) {
    if (Date.now() > deadline) return async () => {};
    await new Promise((r) => setTimeout(r, 250));
  }
  const holder = net.createServer();
  await new Promise<void>((resolve) => holder.listen(port, "localhost", resolve));
  return () => new Promise((resolve) => holder.close(() => resolve()));
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
    const extensionDevPort = await extensionPort();

    const extension = await startExtension(extensionDevPort);
    expect(extension.port).toBe(extensionDevPort);

    const web = await startWebApp(webPort);
    expect(web.port).toBe(webPort);
    expect(await webAppHealth(webPort)).toMatchObject({ status: "ok" });
    expect(((await webAppHealth(extensionDevPort, 2_000)) as { status?: unknown } | undefined)?.status).not.toBe("ok");
  });

  test("web app first, then the extension dev server: the same ports", async () => {
    const webPort = await contestedPort();

    const web = await startWebApp(webPort);
    expect(web.port).toBe(webPort);
    expect(await webAppHealth(webPort)).toMatchObject({ status: "ok" });

    const extensionDevPort = await extensionPort();
    const extension = await startExtension(extensionDevPort);
    expect(extension.port).toBe(extensionDevPort);
    expect(await webAppHealth(webPort)).toMatchObject({ status: "ok" });
  });

  test("its own port taken (another checkout's extension dev server): the extension dev server refuses to move", async () => {
    const release = await holdPort(EXTENSION_DEV_PORT);
    try {
      const server = spawnExtension();
      await waitFor(server, new RegExp(`Port ${EXTENSION_DEV_PORT} is already in use`), "The extension's dev server");
      await expect.poll(() => server.proc.exitCode, { timeout: 30_000 }).not.toBeNull();
      expect(server.proc.exitCode).not.toBe(0);
      expect(server.output()).not.toMatch(/Started dev server/);
    } finally {
      await release();
    }
  });

  test("the README's dev section gives the extension dev server's port", async () => {
    // Its own port, whether it starts on it or finds another checkout's extension dev server there.
    const [, started, refused] = await waitFor(
      spawnExtension(),
      /Started dev server @ http:\/\/localhost:(\d+)|Port (\d+) is already in use/,
      "The extension's dev server",
    );
    const port = Number(started ?? refused);

    const readme = readFileSync("README.md", "utf8");
    const devSection = readme.slice(readme.indexOf("npm run dev"));
    const extensionLine = devSection.split("\n").find((line) => line.includes("npm run dev -w @jobhub/extension"));
    expect(extensionLine).toContain(`http://localhost:${port}`);
  });
});
