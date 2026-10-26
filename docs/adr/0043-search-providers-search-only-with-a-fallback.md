# Search providers return pages only, with one fallback and one contract

Job discovery and Company Dossiers searched the web through Perplexity's Agent API (an LLM with a search tool, `openai/gpt-6-luna`), or Brave, Tavily or Linkup; filters were applied unevenly and Company Dossiers parsed the LLM's answer as JSON, so they had no facts with any other provider. Research: `docs/research/llm-search-tools.md` (branch `research/llm-search-tools`, #384); decision #388.

- **Search providers**: Perplexity through its **Search API** (`search_type: "fast"`, no LLM, $0.001 a call of 1 to 5 queries), Brave and Tavily. **Linkup is dropped** (no date, no country, no paging). No LLM's built-in web search tool is added (dearer, no date filter, no paging).
- **Fallback**: a second Search provider; when the active one fails in a run (key missing, 401/403, 429, outage), the run switches to it until it ends, recorded with the run. Without its key the switch is skipped.
- **One contract**: included and excluded domains, country, maximum age, number of results. A provider lacking one has the adapter apply it to the pages it returns; each declares queries per call and pages, and which filters it handles or emulates. A provider's date stays the weakest source of a Posting date.
- **Company Dossiers**: the company-facts Task Playbook gets a Playbook Agent that reads the pages the Search provider returned and writes the facts; nothing relies on a search provider writing text. A search Task Playbook may still name its own Search provider (ADR-0026 amendment).
- **Keys**: `BRAVE_SEARCH_API_KEY` and `TAVILY_API_KEY` become Provider Secrets with connection tests and hot reload; a missing search key makes web search unavailable (skipped like a source) instead of stopping the AI layer.

This amends ADR-0007 (Perplexity is a search-only provider, called without an LLM) and ADR-0026's amendment (Linkup no longer offered).

## Considered Options

- **Keep the Agent API**: an LLM call per search, priced per token on top, and Company Dossiers tied to one provider.
- **An LLM's own web search tool (Anthropic, OpenAI, Mistral)**: $10 per 1,000 searches plus tokens, no date filter, no paging.
- **No fallback**: one provider's 429 empties a Job Search's web results.
