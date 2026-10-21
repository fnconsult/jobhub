import { afterEach, describe, expect, it, vi } from "vitest";
import { addFetchLayer, type FetchLayer } from "./fetch-layers";

describe("the one wrapper around the fetch in use", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies each layer once per call, even when something wrapped it and it is wrapped again over that", async () => {
    const network = vi.fn(async () => new Response("from the network"));
    vi.stubGlobal("fetch", network);
    const seen: string[] = [];
    const counting: FetchLayer = (input, init, next) => {
      seen.push(String(input));
      return next(input, init);
    };
    addFetchLayer(counting);
    const ours = globalThis.fetch;
    globalThis.fetch = ((input: Request | string | URL, init?: RequestInit) => ours(input, init)) as typeof fetch;
    addFetchLayer(counting);

    const answer = await fetch("https://example.test/");

    expect(await answer.text()).toBe("from the network");
    expect(seen).toEqual(["https://example.test/"]);
    expect(network).toHaveBeenCalledTimes(1);
  });
});
