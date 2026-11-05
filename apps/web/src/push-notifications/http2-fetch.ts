/**
 * A fetch over HTTP/2, which APNs requires (Node's own fetch speaks HTTP/1.1): one connection per origin, kept open and
 * shared by every request to it, as Apple asks of a provider; opened again once it is closed or broken. It answers with
 * a standard Response, so recordingFetch records its calls as any other's.
 */
import { connect, constants, type ClientHttp2Session } from "node:http2";

export interface Http2Fetch {
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<Response>;
  /** Closes every connection. */
  close(): void;
}

/** How long one request may take, answer included. */
const TIMEOUT_MS = 10_000;

export function createHttp2Fetch({ timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {}): Http2Fetch {
  const sessions = new Map<string, ClientHttp2Session>();

  function sessionTo(origin: string): ClientHttp2Session {
    const open = sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(origin);
    const forget = () => {
      if (sessions.get(origin) === session) sessions.delete(origin);
    };
    session.on("close", forget);
    session.on("goaway", forget);
    session.on("error", forget);
    // A connection no request uses lets the process exit.
    session.unref();
    sessions.set(origin, session);
    return session;
  }

  return {
    fetch(url, init) {
      const target = new URL(url);
      return new Promise<Response>((resolve, reject) => {
        let session: ClientHttp2Session;
        try {
          session = sessionTo(target.origin);
        } catch (error) {
          reject(error);
          return;
        }
        session.ref();
        const stream = session.request({
          [constants.HTTP2_HEADER_METHOD]: init.method,
          [constants.HTTP2_HEADER_PATH]: `${target.pathname}${target.search}`,
          ...init.headers,
        });
        const done = () => session.unref();
        stream.setTimeout(timeoutMs, () => stream.close(constants.NGHTTP2_CANCEL));
        const chunks: Buffer[] = [];
        let status = 0;
        const headers = new Headers();
        stream.on("response", (answer) => {
          status = Number(answer[constants.HTTP2_HEADER_STATUS]);
          for (const [name, value] of Object.entries(answer)) if (!name.startsWith(":") && value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
        });
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          done();
          if (!status) reject(new Error(`HTTP/2: no answer from ${target.origin}`));
          else resolve(new Response(chunks.length > 0 && status !== 204 ? Buffer.concat(chunks) : null, { status, headers }));
        });
        stream.on("error", (error) => {
          done();
          reject(error);
        });
        stream.on("close", () => {
          done();
          if (!status) reject(new Error(`HTTP/2: the stream to ${target.origin} closed without an answer`));
        });
        stream.end(init.body);
      });
    },

    close() {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}
