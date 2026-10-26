# Search providers return pages only, with one fallback and one contract

Job discovery and Company Dossiers searched the web through Perplexity's Agent API (an LLM with a search tool, `openai/gpt-6-luna`), or Brave, Tavily or Linkup; filters were applied unevenly and Company Dossiers parsed the LLM's answer as JSON, so they had no facts with any other provider. Research: `docs/research/llm-search-tools.md` (branch `research/llm-search-tools`, #384); decision #388.

- **Search providers**: Perplexity through its **Search API** (`search_type: "fast"`, no LLM, $0.001 a call of 1 to 5 queries), Brave and Tavily. **Linkup is dropped** (no date, no country, no paging). No LLM's built-in web search tool is added (dearer, no date filter, no paging).
- **Fallback**: a second Search provider; `AI_WEB_SEARCH_FALLBACK_PROVIDER`, none by default and refused at start-up if it is the active provider. The run switches to it until it ends, with its queries re-batched, when the active one fails on a missing key, 401/403/408/429, Tavily 432/433, 5xx or no answer (not 400/422, not a stopped search); recorded in the Discovery metrics. Without its key there is no switch and the first error stands.
- **One contract**: included and excluded domains, country, maximum age, number of results. A provider lacking one has the adapter apply it to the pages it returns; each declares queries per call and pages, and which filters it handles or emulates. A provider's date stays the weakest source of a Posting date, Perplexity's `last_updated` included. With both domain lists Perplexity sends the allowlist and drops the excluded domains from the results itself.
- **Settings**: each provider has typed settings (`PERPLEXITY_SEARCH_TYPE`, `PERPLEXITY_QUERIES_PER_CALL`, `BRAVE_MAX_PAGES`, `TAVILY_SEARCH_DEPTH`) replacing `AI_WEB_SEARCH_MODEL`, read for one more release with a warning.
- **Company Dossiers**: the company-facts Task Playbook gets a Playbook Agent that reads the pages the Search provider returned and writes the facts; nothing relies on a search provider writing text. A search Task Playbook may still name its own Search provider (ADR-0026 amendment).
- **Keys**: `BRAVE_SEARCH_API_KEY` and `TAVILY_API_KEY` become Provider Secrets with connection tests and hot reload; a missing search key makes web search unavailable (skipped like a source) instead of stopping the AI layer.

This amends ADR-0007 (Perplexity is a search-only provider, called without an LLM) and ADR-0026's amendment (Linkup no longer offered).

## Considered Options

- **Keep the Agent API**: an LLM call per search, priced per token on top, and Company Dossiers tied to one provider.
- **An LLM's own web search tool (Anthropic, OpenAI, Mistral)**: $10 per 1,000 searches plus tokens, no date filter, no paging.
- **No fallback**: one provider's 429 empties a Job Search's web results.
