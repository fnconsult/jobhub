import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { type Browser, chromium, expect, type Page, test } from "@playwright/test";

// The edge in front of the web app (ADR-0094), as the VPS runs it: Traefik's docker provider reading the labels of
// deploy/compose.yml's `web` and `edge` services, `edge` serving deploy/edge as the VPS does. The web container is a
// stand-in, an nginx forwarding to the suite's web server, with a health check the spec turns on and off, and a switch
// that makes it close every connection unanswered (a crashed app still routed). The browser reaches Traefik's
// published port under the environment's host name. Set E2E_SKIP_DOCKER=1 to skip.
//
// Before the fix, every case but the first answered Traefik's bare `404 page not found` (or `Bad Gateway`).
const ID = `${process.pid}`;
const HOST = "jobbbox.e2e.test";
const SLUG = `jobbbox-e2e-edge-${ID}`;
const NETWORK = `jobbbox-e2e-edge-${ID}`;
const TRAEFIK = `${SLUG}-traefik`;
const WEB = `${SLUG}-web`;
const EDGE = `${SLUG}-edge`;
// The VPS runs its own Traefik, outside the repo: E2E_TRAEFIK_IMAGE runs the spec on another version (v2.11 passes too).
const TRAEFIK_IMAGE = process.env.E2E_TRAEFIK_IMAGE ?? "traefik:v3.6";
const WEB_IMAGE = "nginx:1.27-alpine";
const webPort = Number(process.env.E2E_WEB_PORT);
const dockerOk = spawnSync("docker", ["version"]).status === 0;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" });
const dockerTry = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });

interface ComposeService { image: string; command?: string[]; labels: Record<string, string>; volumes?: { source: string; target: string; read_only?: boolean }[] }

/** deploy/compose.yml as `docker compose config` resolves it for this environment. */
function deployCompose(): Record<string, ComposeService> {
  const envFile = path.join(os.tmpdir(), `${SLUG}.env`);
  writeFileSync(envFile, "");
  const env = { ...process.env, JOBHUB_ENV_FILE: envFile, POSTGRES_PASSWORD: "e2e", JOBHUB_HOST: HOST, JOBHUB_SLUG: SLUG, JOBHUB_REVISION: "e2e", JOBHUB_IMAGES: "e2e", JOBHUB_TARGET: "e2e" };
  const json = execFileSync("docker", ["compose", "-f", "deploy/compose.yml", "-p", SLUG, "config", "--format", "json"], { env, encoding: "utf8" });
  return (JSON.parse(json) as { services: Record<string, ComposeService> }).services;
}

/** A service's labels as `docker run` flags, on the spec's network, marked as the spec's for its Traefik alone. */
const labelFlags = (labels: Record<string, string>) =>
  Object.entries({ ...labels, "traefik.docker.network": NETWORK, "jobbbox.e2e": ID }).flatMap(([key, value]) => ["--label", `${key}=${value}`]);

// The stand-in for the web container: the suite's web server behind it, Dockerfile-like health check on a file.
const STAND_IN_CONF = `server {
  listen 3000;
  location / {
    if (-f /tmp/down) { return 444; }
    proxy_pass http://host.docker.internal:${webPort};
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
  }
}`;

let origin = "";
let browser: Browser;

test.describe("the edge in front of the web app (ADR-0094)", () => {
  test.skip(!dockerOk || !!process.env.E2E_SKIP_DOCKER, "needs docker (E2E_SKIP_DOCKER=1 skips it)");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const services = deployCompose();
    const { web, edge } = services;
    docker("network", "create", NETWORK);
    docker(
      "run", "-d", "--rm", "--name", TRAEFIK, "--network", NETWORK, "-p", "127.0.0.1::443",
      "-v", "/var/run/docker.sock:/var/run/docker.sock:ro", TRAEFIK_IMAGE,
      "--providers.docker=true", "--providers.docker.exposedbydefault=false",
      `--providers.docker.constraints=Label(\`jobbbox.e2e\`,\`${ID}\`)`,
      "--entrypoints.websecure.address=:443",
    );
    const volumes = (edge!.volumes ?? []).flatMap((v) => ["-v", `${v.source}:${v.target}${v.read_only ? ":ro" : ""}`]);
    docker("run", "-d", "--rm", "--name", EDGE, "--network", NETWORK, ...volumes, ...labelFlags(edge!.labels), edge!.image, ...(edge!.command ?? []));
    docker(
      // Not `--rm`: compose stops a container before removing it, and so does the spec.
      "run", "-d", "--name", WEB, "--network", NETWORK, "--add-host", "host.docker.internal:host-gateway",
      "--health-cmd", "test ! -f /tmp/unhealthy", "--health-interval", "1s", "--health-retries", "1", "--health-timeout", "1s",
      ...labelFlags(web!.labels), WEB_IMAGE,
      "sh", "-c", `printf '%s' '${STAND_IN_CONF}' > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'`,
    );
    const port = docker("port", TRAEFIK, "443/tcp").trim().split("\n")[0]!.split(":").at(-1);
    origin = `https://${HOST}:${port}`;
    // Every visit goes straight to Traefik: the host bypasses whatever proxy the machine sets (a sandbox's would refuse it).
    browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`], proxy: { server: "http://127.0.0.1:9", bypass: HOST } });
    await expect.poll(async () => (await fetchVia("/api/health")).status, { timeout: 120_000, intervals: [1000] }).toBe(200);
  });

  test.afterAll(async () => {
    await browser?.close();
    for (const name of [WEB, EDGE, TRAEFIK]) dockerTry("rm", "-f", name);
    dockerTry("network", "rm", NETWORK);
  });

  /** A request through Traefik, as a script would make it (no browser): to its published port, under the host's name. */
  function fetchVia(pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; type: string; body: string }> {
    const url = new URL(origin);
    return new Promise((resolve, reject) => {
      const request = https.get(
        { host: "127.0.0.1", port: url.port, path: pathname, servername: HOST, rejectUnauthorized: false, headers: { host: HOST, ...headers } },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode ?? 0, type: response.headers["content-type"] ?? "", body: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      request.on("error", reject);
    });
  }

  /** A browser's visit through Traefik: the page it shows, and its status. */
  async function visit(pathname: string): Promise<{ page: Page; status: number }> {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const response = await page.goto(`${origin}${pathname}`);
    return { page, status: response!.status() };
  }

  async function expectEdgePage(page: Page, code: number, first: "fr" | "en") {
    await expect(page.locator("body")).not.toContainText("page not found");
    await expect(page.locator(".code")).toHaveText(String(code));
    const titles = page.getByRole("heading", { level: 1 });
    await expect(titles).toHaveText(first === "fr" ? ["Jobbbox revient dans un instant", "Jobbbox will be back in a moment"] : ["Jobbbox will be back in a moment", "Jobbbox revient dans un instant"]);
    await expect(page.locator("html")).toHaveAttribute("lang", first);
  }

  const until = (state: "healthy" | "unhealthy") =>
    expect.poll(() => docker("inspect", "-f", "{{.State.Health.Status}}", WEB).trim(), { timeout: 30_000 }).toBe(state);

  test("an unknown path reaches the app, which shows its own page not found, in the URL's language", async () => {
    const french = await visit("/une-page-qui-n-existe-pas");
    expect(french.status).toBe(404);
    await expect(french.page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    await expect(french.page.locator("body")).not.toContainText("404 page not found");
    const english = await visit("/en/no-such-page");
    expect(english.status).toBe(404);
    await expect(english.page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    // The API keeps its JSON, through its own router.
    const health = await fetchVia("/api/health");
    expect(health.type).toContain("application/json");
  });

  test("a web container routed but not answering (crashed): a 502 shows Jobbbox's page, not Traefik's text", async () => {
    docker("exec", WEB, "touch", "/tmp/down");
    try {
      const { page, status } = await visit("/compte");
      expect(status).toBe(502);
      await expectEdgePage(page, 502, "fr");
      await expect(page.locator("body")).not.toContainText("Bad Gateway");
    } finally {
      docker("exec", WEB, "rm", "-f", "/tmp/down");
    }
  });

  test("no web container routed (unhealthy, as while one starts): every route of the host gets the 503 page, or JSON under /api", async () => {
    docker("exec", WEB, "touch", "/tmp/unhealthy");
    await until("unhealthy");
    try {
      await expect.poll(async () => (await fetchVia("/aide")).status, { timeout: 30_000 }).toBe(503);
      const french = await visit("/aide/une-page");
      expect(french.status).toBe(503);
      await expectEdgePage(french.page, 503, "fr");
      const english = await visit("/en/pricing");
      expect(english.status).toBe(503);
      await expectEdgePage(english.page, 503, "en");
      const chosen = await visit("/legal/cgu?lang=en");
      await expectEdgePage(chosen.page, 503, "en");
      const api = await fetchVia("/api/health", { accept: "application/json" });
      expect(api.status).toBe(503);
      expect(api.type).toContain("application/json");
      expect(JSON.parse(api.body)).toEqual({ error: "unavailable" });
    } finally {
      docker("exec", WEB, "rm", "-f", "/tmp/unhealthy");
      await until("healthy");
    }
    await expect.poll(async () => (await fetchVia("/api/health")).status, { timeout: 30_000 }).toBe(200);
  });

  test("the web container stopped (a deploy replacing it, an app down): the 503 page", async () => {
    docker("stop", "-t", "1", WEB); // as between a deploy's stop of the old container and its new one's start
    // A request already on its way to the stopped container waits for Traefik's dial timeout (30 s), then gets the 504
    // page through the errors middleware; the next ones get edge's 503.
    await expect.poll(async () => (await fetchVia("/")).status, { timeout: 90_000, intervals: [1000] }).toBe(503);
    const { page, status } = await visit("/candidatures");
    expect(status).toBe(503);
    await expectEdgePage(page, 503, "fr");
  });
});
