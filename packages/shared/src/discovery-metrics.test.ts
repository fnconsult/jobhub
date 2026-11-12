import { describe, expect, it } from "vitest";
import { consultedSources, readLiveDiscoveryMetrics, type LiveDiscoveryMetrics } from "./discovery-metrics";

const live: LiveDiscoveryMetrics = {
  step: "search",
  sources: [
    { source: "france_travail", state: "searched" },
    { source: "web_search", state: "searching" },
    { source: "ats_apis", state: "waiting" },
  ],
  pagesRead: 12,
  offersAnalysed: 4,
  matched: null,
  jobOfferIds: ["a", "b", "c", "d"],
};

describe("a run's live metrics (#1001)", () => {
  it("are read back as written, over JSON", () => {
    expect(readLiveDiscoveryMetrics(JSON.parse(JSON.stringify(live)))).toEqual(live);
    expect(readLiveDiscoveryMetrics({ ...live, step: "analysis", matched: 2 })).toMatchObject({ step: "analysis", matched: 2 });
  });

  it("are none when not of their shape", () => {
    expect(readLiveDiscoveryMetrics(null)).toBeNull();
    expect(readLiveDiscoveryMetrics({ ...live, step: "reading" })).toBeNull();
    expect(readLiveDiscoveryMetrics({ ...live, pagesRead: -1 })).toBeNull();
    expect(readLiveDiscoveryMetrics({ ...live, sources: [{ source: "linkedin", state: "searched" }] })).toBeNull();
    expect(readLiveDiscoveryMetrics({ ...live, sources: [...live.sources, live.sources[0]] })).toBeNull();
  });

  it("count as consulted every source past waiting, a refused or failed one included", () => {
    expect(consultedSources(live)).toBe(2);
    expect(consultedSources({ sources: [{ source: "france_travail", state: "refused" }, { source: "web_search", state: "failed" }] })).toBe(2);
  });
});
