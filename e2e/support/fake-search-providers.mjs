// Preloaded into the e2e web server (NODE_OPTIONS=--import) to stand in for the Search providers whose keys are
// Provider Secrets (#399), for their connection tests: Brave's web search (one search of one result) and Tavily's
// usage endpoint. Each accepts a key starting e2e-brave-valid- or e2e-tavily-valid-, and refuses any other with a
// 401 that echoes it back, as some providers do. Nothing reaches the real ones.
const realFetch = globalThis.fetch;

const refused = (key) => Response.json({ error: `invalid key ${key}` }, { status: 401 });

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  if (url.origin === "https://api.search.brave.com" && url.pathname === "/res/v1/web/search") {
    const key = request.headers.get("x-subscription-token") ?? "";
    if (!key.startsWith("e2e-brave-valid-")) return refused(key);
    return Response.json({ type: "search", web: { type: "search", results: [{ url: "https://example.com/", title: "Example", description: "" }] } });
  }
  if (url.origin === "https://api.tavily.com" && url.pathname === "/usage") {
    const key = /^Bearer (.*)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!key.startsWith("e2e-tavily-valid-")) return refused(key);
    return Response.json({ key: { usage: 1, limit: 1000 }, account: { current_plan: "Researcher", plan_usage: 1, plan_limit: 1000 } });
  }
  return realFetch(input, init);
};
