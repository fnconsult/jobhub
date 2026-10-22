// The e2e web server's processes end with whoever started them.
//
// Playwright starts e2e/support/web-server.mjs, which starts `npx next start`, which
// starts next-server. When Playwright is killed outright (SIGKILL, a timed-out shell),
// nothing signals the rest of that chain: npx and next-server were left running,
// reparented to launchd, their stdout a socket nobody reads. next-server then spins
// on EPIPE (an uncaught write error, logged to the same dead pipe, again and again)
// at a quarter of a core each, for hours; enough of them left the machine too
// loaded to sign anyone in within the suite's timeouts.
//
// Importing this module (web-server.mjs does; `exitWithParentEnv` preloads it into
// the processes it starts, through NODE_OPTIONS) makes the process exit as soon as
// its parent is gone, so the whole chain unwinds from the top.
import { fileURLToPath } from "node:url";

const CHECK_EVERY_MS = 500;

const parent = process.ppid;
setInterval(() => {
  // Orphaned: the process was handed to launchd/init (or a subreaper), its parent pid changed.
  if (process.ppid !== parent) process.exit(1);
}, CHECK_EVERY_MS).unref();

const self = fileURLToPath(import.meta.url);

/** `env` for a child process that should exit with its parent, too (and its own children with it). */
export function exitWithParentEnv(env) {
  const preload = `--import=${self}`;
  const options = env.NODE_OPTIONS ?? "";
  return { ...env, NODE_OPTIONS: options.includes(preload) ? options : `${options} ${preload}`.trim() };
}
