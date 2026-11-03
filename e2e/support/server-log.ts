import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

// The output of a web app a spec starts for itself (#673): copied to a file in the run's output folder, which CI uploads
// when the run fails, so a server that answered 404 or never came up says why after the runner is gone.
// One file per start: `<label>-<port>-<n>.log`, n counting the starts of that label and port in this worker.

const starts = new Map<string, number>();

/** The folder the copies go to: test-results/e2e-<E2E_WEB_PORT>/servers, inside the run's output folder. */
export const serverLogDir = () => path.resolve("test-results", `e2e-${process.env.E2E_WEB_PORT ?? 3001}`, "servers");

/** A writer for one server's output, and the file it writes. */
export function serverLog(label: string, port: number): { write: (chunk: Buffer | string) => void; file: string } {
  const key = `${label}-${port}`;
  const n = (starts.get(key) ?? 0) + 1;
  starts.set(key, n);
  mkdirSync(serverLogDir(), { recursive: true });
  const file = path.join(serverLogDir(), `${key}-${process.pid}-${n}.log`);
  const stream = createWriteStream(file, { flags: "w" });
  stream.write(`[server-log] ${label} on port ${port}, started ${new Date().toISOString()}\n`);
  return { write: (chunk) => stream.write(chunk), file };
}
