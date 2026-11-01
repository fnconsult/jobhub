#!/usr/bin/env node
/**
 * Checks Email intake's MTA from outside (#580), without delivering anything:
 *
 *   node apps/mta/scripts/probe.mjs mx.jobbbox.ai alertes.staging.jobbbox.ai [port]
 *
 *  - EHLO offers STARTTLS and announces its size cap (SIZE);
 *  - a recipient on another domain is refused (550: no relay), and so is a subdomain of the intake domain;
 *  - a recipient on the intake domain is taken (250), then the transaction is reset: no DATA is sent;
 *  - an email announced over the cap (MAIL FROM … SIZE=) is refused (550).
 * Exit code 0 when all hold. Many networks block outgoing port 25: run it from a host that may send mail.
 */
import net from "node:net";

const [host, domain, port = "25"] = process.argv.slice(2);
if (!host || !domain) {
  console.error("usage: probe.mjs <mx host> <intake domain> [port]");
  process.exit(2);
}

const socket = net.connect(Number(port), host);
socket.setTimeout(30_000, () => socket.destroy(new Error("timed out")));
let buffer = "";
const waiting = [];
socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  // A reply ends on a line "NNN text" (a space after the code, not a dash).
  let end;
  while ((end = buffer.search(/^\d{3} .*\r\n/m)) >= 0) {
    const lineEnd = buffer.indexOf("\r\n", end) + 2;
    const reply = buffer.slice(0, lineEnd);
    buffer = buffer.slice(lineEnd);
    waiting.shift()?.(reply);
  }
});
const next = () => new Promise((resolve) => waiting.push(resolve));
const send = (line) => {
  socket.write(`${line}\r\n`);
  return next();
};

let failures = 0;
function check(label, reply, expected) {
  const ok = expected.test(reply);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${reply.trim().split("\r\n").at(-1)}`);
}

try {
  check("greeting", await next(), /^220/);
  const ehlo = await send("EHLO probe.jobbbox.invalid");
  check("STARTTLS offered", ehlo, /^250[- ]STARTTLS/im);
  const size = Number(/^250[- ]SIZE (\d+)/im.exec(ehlo)?.[1] ?? 0);
  check(`size cap announced (${size} bytes)`, ehlo, /^250[- ]SIZE \d+/im);
  check("MAIL FROM", await send("MAIL FROM:<probe@example.com>"), /^250/);
  check("another domain refused (no relay)", await send("RCPT TO:<someone@example.com>"), /^550/);
  check("a subdomain refused", await send(`RCPT TO:<x@sub.${domain}>`), /^550/);
  check(`${domain} taken`, await send(`RCPT TO:<probe-not-a-forwarding-address@${domain}>`), /^250/);
  check("reset, nothing sent", await send("RSET"), /^250/);
  check("an email over the cap refused", await send(`MAIL FROM:<probe@example.com> SIZE=${(size || 10485760) + 1}`), /^5\d\d/);
  await send("QUIT");
} catch (error) {
  failures += 1;
  console.error(`✗ ${error.message}`);
} finally {
  socket.end();
}
process.exit(failures === 0 ? 0 : 1);
