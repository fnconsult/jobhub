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

## Not verified
- Exact rate limits, default model recommendation, and whether `max_steps: 1` still performs a search. Confirm with one live call using a real key (acceptance check in the issue).
- Exact fixture bytes: record a real `/v1/agent` response rather than hand-writing one.
