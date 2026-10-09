# Research for issue #74: Perplexity Agent API for searchWeb

Scope: only the Perplexity facts needed to replace `/chat/completions` (model `sonar`) with the Agent API. The quota release part is internal. Fetched 2026-10-09.

## Endpoint and auth
Source: https://docs.perplexity.ai/docs/agent-api/quickstart
- Primary endpoint is `POST https://api.perplexity.ai/v1/agent`. The docs say `POST /v1/responses` is also accepted as an alias (OpenAI SDK compatibility). The 403 `chat_completions_not_available` hint "Use /v1/responses" is therefore valid; prefer `/v1/agent` as canonical.
- Auth: `Authorization: Bearer $PERPLEXITY_API_KEY` (bearer scheme per the OpenAPI spec at https://docs.perplexity.ai/api-reference/responses-post).
- The docs fetched do not mention a chat/completions deprecation; the 403 from the issue is the only evidence.

## Request
Source: https://docs.perplexity.ai/api-reference/responses-post
- Only `input` (string or item array) is required. `model` is required unless `models` or `preset` is set.
- `model` uses `provider/model` format (e.g. `openai/gpt-5.6-sol`, `anthropic/claude-sonnet-4-6`). `sonar` is not that format. The existing env model setting must hold a `provider/model` value (or switch to `preset`, e.g. `fast`/`low`). Pick and verify a currently listed model before choosing a default.
- `anthropic/*` models REQUIRE `max_output_tokens` (else HTTP 400). Setting it always is safest.
- Web search is opt-in: `tools: [{"type": "web_search"}]` (optional `max_results` 1-50, `filters`, `search_type` web|fast, `user_location`). Without it the model will not search.
- `instructions` carries the system prompt. `max_steps` defaults to 1 with `model` and no preset; a search tool call likely needs more than 1 step, so set it (1-100) or use a preset. Verify with a live call.
- `store: false` hides the response from later retrieval.

## Response (non-streaming)
- Top level: `id`, `object: "response"`, `status` (`completed|failed|incomplete|in_progress|queued|cancelled`), `model`, `output[]`, `usage`, `error` on failure.
- Answer: no `output_text` convenience field. Concatenate `text` of `type: "output_text"` parts inside `output` items with `type: "message"`.
- Sources: two places. `output` item `type: "search_results"` has `queries` and `results[]` (`url`, `title`, `snippet`, `date`, `last_updated`, `source`); and `annotations` on text parts with `type: "url_citation"` (`url`, `title`, `start_index`, `end_index`). There is no top-level `citations`/`search_results` field as in chat/completions. Prefer `search_results` for the full source list (dedupe by url).
- Usage: `usage.input_tokens`, `output_tokens`, `total_tokens`, plus `cost` (`total_cost` USD) and `tool_calls_details`. Names differ from chat/completions (`prompt_tokens`/`completion_tokens`); map them for `ai_usage`.
- Check `status` is `completed` (HTTP 200 can still carry `failed`/`incomplete`); treat others as search failure.
- Errors: 400 body `{ "error": { "code", "message", "type" } }`.

## Presets
Source: https://docs.perplexity.ai/docs/agent-api/presets (fetched 2026-10-09)
- `fast`: model `openai/gpt-6-luna`, `web_search` (`search_type: "fast"`), no other tool, `max_steps` 1. So the preset itself is a web-search setup; the fixture's `model` matches it.
- Fields passed alongside a preset override its defaults (`model`, `max_steps`, `max_output_tokens`). `tools` merge per tool: our `[{ "type": "web_search" }]` keeps the preset's web search, it does not replace the set.

## Checked against the live API
- 2026-10-09, with an invalid key: `POST https://api.perplexity.ai/v1/responses` answers 401 `invalid_api_key` (the route exists; the live test goes red on any 4xx).

## Not verified (needs a real key)
- That `preset: "fast"` + our request completes with `status: "completed"` and real sources, and which `AI_WEB_SEARCH_MODEL` values are accepted. Run the live contract test:
  `PERPLEXITY_LIVE=1 PERPLEXITY_API_KEY=... npx vitest run packages/ai/src/providers/perplexity.live.test.ts`
  (add `AI_WEB_SEARCH_MODEL=provider/model` to check a configured model). It sends exactly what `searchWeb` sends.
- Exact fixture bytes: `fixtures/perplexity-responses-search.json` is hand-written from the reference. The live test saves the real reply as `fixtures/perplexity-responses-search.recorded.json`, which `providers.test.ts` then also parses; commit it.
- Exact rate limits.
