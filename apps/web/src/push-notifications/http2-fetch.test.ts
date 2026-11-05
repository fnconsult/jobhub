import { createServer, type Http2Server } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttp2Fetch } from "./http2-fetch";

/** A cleartext HTTP/2 server answering every stream as `answer` says, keeping what it received. */
async function h2Server(answer: (headers: Record<string, unknown>, body: string) => { status: number; body?: string }) {
  const received: { headers: Record<string, unknown>; body: string }[] = [];
  const server: Http2Server = createServer();
  const sessions = new Set<unknown>();
  server.on("session", (session) => sessions.add(session));
  server.on("stream", (stream, headers) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => (body += chunk));
    stream.on("end", () => {
      received.push({ headers, body });
      const reply = answer(headers, body);
      stream.respond({ ":status": reply.status, "content-type": "application/json" });
      stream.end(reply.body ?? "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, received, sessions, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("an HTTP/2 fetch (APNs speaks nothing else)", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("posts its headers and body and reads the answer's status and body", async () => {
    const server = await h2Server(() => ({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) }));
    const http2 = createHttp2Fetch();
    cleanups.push(() => http2.close(), server.close);
    const response = await http2.fetch(`${server.origin}/3/device/abc`, { method: "POST", headers: { "apns-topic": "ai.jobbbox.app" }, body: '{"aps":{}}' });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ reason: "Unregistered" });
    expect(server.received).toEqual([{ headers: expect.objectContaining({ ":method": "POST", ":path": "/3/device/abc", "apns-topic": "ai.jobbbox.app" }), body: '{"aps":{}}' }]);
  });

  it("sends every request to one host over one connection", async () => {
    const server = await h2Server(() => ({ status: 200 }));
    const http2 = createHttp2Fetch();
    cleanups.push(() => http2.close(), server.close);
    await Promise.all([1, 2, 3].map((n) => http2.fetch(`${server.origin}/3/device/${n}`, { method: "POST", headers: {}, body: "{}" })));
    await http2.fetch(`${server.origin}/3/device/4`, { method: "POST", headers: {}, body: "{}" });
    expect(server.received).toHaveLength(4);
    expect(server.sessions.size).toBe(1);
  });

  it("connects again once the connection is gone", async () => {
    const server = await h2Server(() => ({ status: 200 }));
    const http2 = createHttp2Fetch();
    cleanups.push(() => http2.close(), server.close);
    await http2.fetch(`${server.origin}/a`, { method: "POST", headers: {}, body: "{}" });
    for (const session of server.sessions) (session as { destroy(): void }).destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await http2.fetch(`${server.origin}/b`, { method: "POST", headers: {}, body: "{}" })).status).toBe(200);
    expect(server.sessions.size).toBe(2);
  });
});
