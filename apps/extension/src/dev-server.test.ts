// @vitest-environment node
import { createServer as createNetServer, type Server } from "node:net";
import { fileURLToPath } from "node:url";
import { createServer } from "wxt";
import { afterEach, describe, expect, it } from "vitest";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));

// The port the extension's dev server gets, as WXT resolves it from wxt.config.ts alone.
// WXT only probes the machine for a free port when strictPort is off, so with the
// config's strictPort this is 3100 whatever else is running; were 3100 busy (another
// checkout's dev server) and strictPort off, WXT would silently move to a random port.
async function configuredDevServerPort() {
  const server = await createServer({ root: extensionRoot });
  return server.port;
}

// Holds a port the way another running dev server would. Already held: nothing to do.
function occupy(port: number): Promise<Server | undefined> {
  return new Promise((resolve) => {
    const holder = createNetServer();
    holder.once("error", () => resolve(undefined));
    holder.listen(port, "localhost", () => resolve(holder));
  });
}

// The web app's dev server (Next.js) is on 3000 and the extension's default
// WXT_WEB_ORIGIN points there, so the extension's dev server must never take it,
// whichever of the two starts first (#71).
describe("extension dev server", () => {
  let holder: Server | undefined;

  afterEach(async () => {
    const held = holder;
    holder = undefined;
    if (held) await new Promise((resolve) => held.close(resolve));
  });

  it("uses its own port, 3100, leaving 3000 to the web app", async () => {
    expect(await configuredDevServerPort()).toBe(3100);
  });

  // Fails loudly instead (WXT's "port already in use") rather than silently taking a random port.
  it("keeps 3100 even while 3100 is already in use", async () => {
    holder = await occupy(3100);

    expect(await configuredDevServerPort()).toBe(3100);
  });
});
