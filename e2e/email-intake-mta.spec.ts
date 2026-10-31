import { execFileSync, spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { alertEmail, mimeOf } from "../apps/web/src/email-intake/fixtures/inbound-emails";
import { readInboundEmail } from "../apps/web/src/email-intake/inbound-email";

// Issue #580: Email intake's own receiving MTA (Haraka), the image built from apps/mta/Dockerfile, driven over SMTP as an
// outside mail server would. The app behind it is a small HTTP server of the spec's own, in a second container. Set
// E2E_SKIP_DOCKER=1 to skip.
const DOMAIN = "alertes.staging.jobbbox.ai";
const SECRET = "e2e-mta-route-secret-0123456789abcdef";
const IMAGE = `jobbbox-mta-e2e-${process.pid}`;
const MTA = `jobbbox-mta-e2e-${process.pid}`;
const APP = `jobbbox-mta-e2e-app-${process.pid}`;
const NETWORK = `jobbbox-mta-e2e-net-${process.pid}`;
const dockerOk = spawnSync("docker", ["version"]).status === 0;

interface Posted { headers: Record<string, string>; body: Buffer }

// Nothing is published on the host: the MTA and the fake app share a private docker network, and the SMTP conversation
// is held from inside the MTA's container (its own node), so the suite exposes no port and runs wherever docker runs.
const FAKE_APP = `
const http = require("http"), fs = require("fs");
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    fs.appendFileSync("/tmp/posted.jsonl", JSON.stringify({ headers: req.headers, body: Buffer.concat(chunks).toString("base64") }) + "\\n");
    let status = 200;
    try { status = Number(fs.readFileSync("/tmp/status", "utf8")); } catch {}
    res.statusCode = status; res.end("{}");
  });
}).listen(3000);`;

const SMTP_DRIVER = `
const net = require("net");
const steps = JSON.parse(require("fs").readFileSync(0, "utf8"));
const socket = net.connect(2525, "127.0.0.1");
socket.setTimeout(120000, () => socket.destroy(new Error("timed out")));
let buffer = ""; const waiting = [];
socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8"); let end;
  while ((end = buffer.search(/^\\d{3} .*\\r\\n/m)) >= 0) {
    const lineEnd = buffer.indexOf("\\r\\n", end) + 2;
    const reply = buffer.slice(0, lineEnd); buffer = buffer.slice(lineEnd);
    waiting.shift()?.(reply);
  }
});
socket.on("error", (e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
const next = () => new Promise((resolve) => waiting.push(resolve));
(async () => {
  const replies = [await next()];
  for (const step of steps) {
    const reply = next();
    if (step.line !== undefined) socket.write(step.line + "\\r\\n");
    else if (step.data !== undefined) socket.write(step.data + "\\r\\n.\\r\\n");
    else { // a message of step.bigBytes bytes, in lines of 998 characters
      socket.write("Subject: big\\r\\n\\r\\n");
      const line = "x".repeat(998) + "\\r\\n";
      for (let sent = 0; sent < step.bigBytes && !socket.destroyed; sent += line.length) { if (!socket.write(line)) await new Promise((r) => socket.once("drain", r)); }
      socket.write(".\\r\\n");
    }
    replies.push(await reply);
  }
  console.log(JSON.stringify({ replies: replies.map((r) => r.trim()) }));
  socket.destroy();
})();`;

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" });
const dockerTry = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });

/** One SMTP conversation with the MTA: each step's reply (the greeting first), as an outside mail server would see it. */
function smtp(steps: ({ line: string } | { data: string } | { bigBytes: number })[]): string[] {
  const result = spawnSync("docker", ["exec", "-i", MTA, "node", "-e", SMTP_DRIVER], { input: JSON.stringify(steps), encoding: "utf8", maxBuffer: 1 << 24 });
  const parsed = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as { replies?: string[]; error?: string };
  if (!parsed.replies) throw new Error(`SMTP session failed: ${parsed.error ?? result.stderr}`);
  return parsed.replies.map((reply) => reply.split("\r\n").at(-1)!);
}

const lines = (...commands: string[]) => commands.map((line) => ({ line }));
const setAppStatus = (status: number) => docker("exec", APP, "sh", "-c", `echo ${status} > /tmp/status`);
function posted(): Posted[] {
  const out = dockerTry("exec", APP, "sh", "-c", "cat /tmp/posted.jsonl 2>/dev/null").stdout.trim();
  return out === "" ? [] : out.split("\n").map((l) => { const j = JSON.parse(l) as { headers: Record<string, string>; body: string }; return { headers: j.headers, body: Buffer.from(j.body, "base64") }; });
}

async function waitForGreeting(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if (smtp([])[0]?.startsWith("220")) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`the MTA never greeted: ${dockerTry("logs", MTA).stdout}`);
}

test.describe("Email intake's MTA, over SMTP", () => {
  test.skip(!dockerOk || !!process.env.E2E_SKIP_DOCKER, "docker not available");
  test.describe.configure({ mode: "serial", timeout: 300_000 });
  const address = `k7d2m4q9x3b5n8ta@${DOMAIN}`;
  const mime = () => mimeOf(alertEmail(address)).replace(/\r?\n/g, "\r\n");
  const deliver = () => smtp([...lines("EHLO probe.example.test", "MAIL FROM:<offres@alertes.cadremploi.fr>", `RCPT TO:<${address}>`, "DATA"), { data: mime() }]);

  test.beforeAll(() => {
    test.setTimeout(600_000);
    docker("network", "create", NETWORK);
    docker("run", "-d", "--rm", "--name", APP, "--network", NETWORK, "node:22-alpine", "node", "-e", FAKE_APP);
    docker("build", "-q", "-f", "apps/mta/Dockerfile", "-t", IMAGE, ".");
    docker(
      "run", "-d", "--rm", "--name", MTA, "--network", NETWORK,
      "-e", `INTAKE_ROUTE_1_DOMAIN=${DOMAIN}`,
      "-e", `INTAKE_ROUTE_1_URL=http://${APP}:3000/api/email-intake/inbound`,
      "-e", `INTAKE_ROUTE_1_SECRET=${SECRET}`,
      IMAGE,
    );
    return waitForGreeting();
  });

  test.afterAll(() => {
    if (!dockerOk) return;
    dockerTry("rm", "-f", MTA, APP);
    dockerTry("network", "rm", NETWORK);
    dockerTry("rmi", "-f", IMAGE);
  });

  test.beforeEach(() => {
    dockerTry("exec", APP, "sh", "-c", "rm -f /tmp/posted.jsonl /tmp/status");
  });

  test("announces STARTTLS and its 10 MB size cap", () => {
    const ehlo = spawnSync("docker", ["exec", "-i", MTA, "node", "-e", `
      const s = require("net").connect(2525, "127.0.0.1"); let d = "";
      s.on("data", (c) => { d += c; if (/^220 /m.test(d) && !d.includes("sent")) { d += "sent"; s.write("EHLO probe.example.test\\r\\n"); } if (/^250 /m.test(d)) { console.log(d); process.exit(0); } });`], { encoding: "utf8" }).stdout;
    expect(ehlo).toMatch(/250[- ]STARTTLS/i);
    expect(ehlo).toMatch(/250[- ]SIZE 10485760/i);
  });

  test("refuses mail for any other domain, a subdomain or the parent of the intake domain (no relay), and takes the intake domain's", () => {
    const replies = smtp(lines("EHLO probe.example.test", "MAIL FROM:<probe@example.com>", "RCPT TO:<someone@example.com>", `RCPT TO:<x@sub.${DOMAIN}>`, `RCPT TO:<x@${DOMAIN.split(".").slice(1).join(".")}>`, `RCPT TO:<${address}>`));
    expect(replies.slice(3, 6).map((r) => r.slice(0, 3))).toEqual(["550", "550", "550"]);
    expect(replies[6]!.slice(0, 3)).toBe("250");
    expect(posted()).toEqual([]);
  });

  test("refuses an email announced over 10 MB, and one that really is over it", () => {
    const announced = smtp(lines("EHLO probe.example.test", `MAIL FROM:<probe@example.com> SIZE=${10 * 1024 * 1024 + 1}`));
    expect(announced[2]).toMatch(/^5\d\d/);

    const actual = smtp([...lines("EHLO probe.example.test", "MAIL FROM:<probe@example.com>", `RCPT TO:<${address}>`, "DATA"), { bigBytes: 10 * 1024 * 1024 + 4096 }]);
    expect(actual.at(-1)).toMatch(/^5\d\d/);
    expect(posted()).toEqual([]);
  });

  test("posts an accepted email to the app: raw message, envelope, the MTA's stamp and the route's secret", async () => {
    const replies = deliver();

    expect(replies.at(-1)).toMatch(/^250/);
    const requests = posted();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.headers["x-inbound-secret"]).toBe(SECRET);
    expect(request!.headers["content-type"]).toBe("message/rfc822");
    const read = await readInboundEmail(new Request("http://app.test/api/email-intake/inbound", { method: "POST", headers: request!.headers, body: new Uint8Array(request!.body) }));
    expect(read).toMatchObject({ recipients: [address] });
    expect(read!.text).toContain("Chef de projet digital H/F");
    expect(read!.authenticationResults).toMatch(/^mx\.jobbbox\.ai;/);
  });

  test("a failure of the app (500) or its refusing the secret (401) defers the email with a 4xx, so its sender retries", () => {
    for (const status of [500, 401]) {
      setAppStatus(status);
      expect(deliver().at(-1)).toMatch(/^4\d\d/);
    }
  });
});
