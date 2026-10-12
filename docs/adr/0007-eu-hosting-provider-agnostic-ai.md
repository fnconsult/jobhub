# EU hosting and swappable AI providers

CVs are sensitive personal data, and B2B outplacement buyers (ADR-0004) will check where data is stored. All data is stored in the EU. AI calls go through one provider-agnostic layer with adapters for Anthropic (Claude, the default), Mistral and OpenAI, and for web search Perplexity (the default), Brave, Tavily and Linkup.

The rule for personal data (CVs, Profiles, Applications, Tailored Documents):
- It is sent only to EU-resident endpoints: Claude through an EU region (AWS Bedrock eu-west-3 or Vertex AI EU), Mistral, or OpenAI with EU data residency.
- The web search provider (Perplexity, Brave, Tavily or Linkup, ADR-0002) is used only for web search and receives only search queries built from Search Criteria or from an employer's name, never CV content or a person's name.

## Amendment: employer names in web search (issue #17)

A Company Dossier for an employer that is not in the French company register (a foreign company, mostly) can only come from the web, so the web search also receives a query built from the employer's name (`buildCompanyQuery`). An employer's name is about a company, not the Candidate: it is public, it comes from the public Job Offer or from the Candidate naming the hiring company, and it carries no CV content. Sending it outside the EU does not move personal data there.

What keeps this from carrying a person's name:
- The query is built from the employer's name alone, cleaned like Search Criteria (no email or phone).
- A name the register lists as a sole trader (a private person), or a SIREN it does not list as a company, is never sent: the Candidate is asked to name the hiring company instead.
- What comes back is filtered before it is stored: only short facts of the expected shape are kept (no street address, nothing naming a person), and only web pages as sources, never a person's profile.

## Amendment: pluggable web search providers (issue #110)

Web search can be served by Brave, Tavily or Linkup as well as Perplexity, chosen with `AI_WEB_SEARCH_PROVIDER` (Perplexity stays the default). We treat all of them as outside the EU: their data hosting was not established, so this decision does not rest on where they run. It rests on what they receive, which is the same as Perplexity: a query built only from Search Criteria (`buildSearchQuery`) or from an employer's name (`buildCompanyQuery`, see the amendment above), never Profile, CV or identity data. Sending such a query outside the EU does not move personal data there.

What keeps it that way:
- Both `searchWeb` and `searchCompany` go through the single `web_search` route of the AI layer, and the layer builds the query itself: callers pass Search Criteria or an employer's name, never free text. Free-text fields are cleaned (no email or phone) and capped.
- The only other input is a search filter (domains to include or exclude, a maximum page age), which names websites and a time window, not the Candidate.
- These adapters can only search. The AI layer refuses at start-up to route a text task to them, so no task that carries personal data can reach them.
