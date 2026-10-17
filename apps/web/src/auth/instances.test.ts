import { describe, expect, it } from "vitest";
import { swapWhenReady } from "./instances";

/** An instance whose start the test finishes by hand. */
function instance(version: string) {
  let start!: () => void;
  const ready = new Promise<void>((resolve) => (start = resolve));
  return { version, ready, start };
}

describe("the sign-in instance in use", () => {
  it("is the first one built at once, then a rebuilt one only once it has started", async () => {
    const built: ReturnType<typeof instance>[] = [];
    const instances = swapWhenReady((made: ReturnType<typeof instance>) => made.ready);
    const get = (version: string) =>
      instances.get(version, () => {
        const made = instance(version);
        built.push(made);
        return made;
      });

    expect(get("v1").version).toBe("v1");
    // v2 is being started (an OIDC issuer slow to answer): requests keep v1 meanwhile.
    expect(get("v2").version).toBe("v1");
    expect(get("v2").version).toBe("v1");
    expect(built.map((made) => made.version)).toEqual(["v1", "v2"]);

    built[1]!.start();
    await instances.settled("v2", 1000);
    expect(get("v2").version).toBe("v2");
  });

  it("gives up waiting after the time limit, keeping the one in use", async () => {
    const instances = swapWhenReady((made: ReturnType<typeof instance>) => made.ready);
    instances.get("v1", () => instance("v1"));
    instances.get("v2", () => instance("v2"));

    const started = Date.now();
    await instances.settled("v2", 50);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(instances.get("v2", () => instance("v2")).version).toBe("v1");
  });

  it("uses a rebuilt one whose start failed rather than stay on an old configuration", async () => {
    const instances = swapWhenReady((made: { version: string }) => (made.version === "v2" ? Promise.reject(new Error("init failed")) : Promise.resolve()), { log: () => {} });
    instances.get("v1", () => ({ version: "v1" }));
    instances.get("v2", () => ({ version: "v2" }));

    await instances.settled("v2", 1000);

    expect(instances.get("v2", () => ({ version: "v2" })).version).toBe("v2");
  });
});
