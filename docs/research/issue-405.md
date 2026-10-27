# Research for #405: company facts read from Search provider pages

Checked 2026-10-26, only what implementation needs. Question: what do Perplexity Search, Brave and Tavily return per result, i.e. do they give page text the Playbook Agent can read?

## 1. Tavily (verified, primary)
Source: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Request: `search_depth` (`basic` default, `advanced` = 2 credits, `fast`, `ultra-fast`), `max_results` 0-20 (default 10), `include_raw_content` (`false` default; `true`/`markdown` = markdown, `text` = plain text, may add latency).
- Result: `title`, `url`, `content` (short snippet), `raw_content` (cleaned page content, `null` unless `include_raw_content`), `score`. Ordered by relevance.
- Implication: full page text needs `include_raw_content`.

## 2. Perplexity Search API (verified, primary)
Source: https://docs.perplexity.ai/api-reference/search-post
- `POST https://api.perplexity.ai/search`. Params: `query` (string or array), `max_results` 1-50 (default 10), `search_type` (`web`, `fast`, `people`), `max_tokens` (total page-content cap), `max_tokens_per_page`, `country`, `search_language_filter`, `search_domain_filter`, date filters.
- Result: `title`, `url`, `snippet` ("content snippet extracted from the page"), nullable `date`, `last_updated`. Response also has `id`, `server_time`.
- No separate full-text field is documented; the `snippet` is the page content, sized by `max_tokens_per_page`. Raise it to give the agent more text.

## 3. Brave (partly verified)
Source: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
- Web search result: `title`, `url`, `description`; with `extra_snippets=true` also `extra_snippets` (up to 5 extra excerpts). Brave says web results are "intended for human consumption" and points agents to the LLM Context endpoint.
- Full page text is not documented for web search.
- LLM Context endpoint: `/res/v1/llm/context` (GET and POST, header `X-Subscription-Token`) extracts page content (text chunks, tables, code, structured data). NOT verified against Brave's own docs: their doc URLs for it returned 404 from here, and the only sources found were mirrors and OpenClaw docs (https://docs.openclaw.ai/tools/brave-search.md). The response schema is unknown.

## Implications
1. A common input shape is feasible: normalise each provider to `{title, url, text}` where text is Tavily `raw_content` (fallback `content`), Perplexity `snippet`, Brave `description` + `extra_snippets` joined. Fixture tests per provider map to the same facts JSON, as the acceptance criteria want.
2. Brave via plain web search gives only snippets, so facts will be thinner; the e2e "Brave as provider" case should expect that, or use LLM Context.
3. Tavily needs `include_raw_content` set in the existing adapter; check what the current adapter sends.
4. Perplexity: set `max_tokens_per_page` deliberately (cost and context size).

## Open questions
- Brave LLM Context response schema and plan/price: check the dashboard docs while logged in, or capture a live response as a fixture.
- Whether the repo's current Brave/Tavily/Perplexity adapters request these fields (not inspected beyond `BRAVE_SEARCH_API_KEY` and `TAVILY_API_KEY` in `apps/web/src/platform-settings/catalog.ts`).
- Provider terms on feeding returned page text to an LLM were not checked.
