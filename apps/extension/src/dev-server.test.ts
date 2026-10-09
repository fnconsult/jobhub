// @vitest-environment node
import { fileURLToPath } from "node:url";
import { createServer } from "wxt";
import { describe, expect, it } from "vitest";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));

// The web app's dev server (Next.js) is on 3000 and the extension's default
// WXT_WEB_ORIGIN points there, so the extension's dev server must never take it,
// whichever of the two starts first (#71).
describe("extension dev server", () => {
  it("uses its own port, 3100, leaving 3000 to the web app", async () => {
    const server = await createServer({ root: extensionRoot });

    expect(server.port).toBe(3100);
  });
});
