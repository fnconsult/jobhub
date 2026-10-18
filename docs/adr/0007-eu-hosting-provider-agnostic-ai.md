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

## Amendment: job title variants and a country filter in web search (issue #112)

A Job Search now sends up to six queries instead of one: the Search Criteria job title and up to two variants (other titles recruiters use for the same job), each worded in French and in English, with results paged. The variants are written by an AI step (`job_titles`, an EU-resident text provider) that is given the Search Criteria job title alone, cleaned like every Search Criteria field. So the query can now carry a job title an AI wrote. That title comes from the Search Criteria title only and names a job, not the Candidate. Sending it outside the EU does not move personal data there.

What keeps it that way:
- `planJobSearch` is the only way to get a Job Search query (`JobSearchQuery`). Each title it returns, the Search Criteria's own or a variant, is cleaned (no email or phone) and capped. A query is opaque: `searchWeb` refuses any query `planJobSearch` did not return, a copy included, so a caller still cannot pass free text. The layer still words the query itself, from the Search Criteria and the planned title.
- The AI step never sees Profile, CV or identity data, and its call is logged as the `job_titles` task.
- Search filters may also name a country (ISO 3166-1 alpha-2; Job discovery sends "FR"), so the provider favours pages from that country. That is a place, not the Candidate. The layer refuses a country filter that is not a two-letter code. The other filters stay as before: domains to include or exclude and a maximum page age.
- Paging adds no input: a next page repeats the same planned query.

## Amendment: identity routing under EU AI consent (issue #121)

A Candidate can give an explicit, recorded EU AI consent, stored with its date and editable on their account page (they can withdraw it at any time). With that consent, any AI call whose prompt contains identifying data (name, postal address, phone, email, the raw CV text or the Master CV identity block) is routed to Mistral (`AI_IDENTITY_MODEL` picks the model), whatever provider is configured for its task. Without consent, or for a call with no identity, the provider configured for the task applies as before.

How a call is recognised:
- Call sites declare `containsIdentity: true`, from the fields they inject into the prompt.
- As a safety net, the AI layer scans the prompt for a phone number or an email address. An undeclared hit is routed to Mistral and logged (the task and the kinds found, never the prompt), so the call site can be fixed.
- The identity block of the CV is stripped before scoring and before any AI re-ranking, so those calls never carry identity.

## Amendment: the coaching context carries no identity (issue #126)

The AI Coach's context is no longer identity-bearing, so the coaching call declares `containsIdentity: false` and stays on the `coaching` task instead of going to Mistral. Only the Candidate's first name is sent, the Master CV's identity block is dropped, and its values (full name, email, phone, address) are replaced wherever else the CV writes them. The scan above remains the safety net.

## Addendum: every AI call is persisted (issue #218)

The AI layer's `UsageLog`, until now a JSON line on stdout, also writes to Postgres, in the web app and the worker, for the Back Office's AI consumption report. Every call through the layer is recorded, failed ones included (no tokens, nothing billed), with its duration, its estimated cost (the Coach Message Cost's price table and EUR conversion) and the tools its model used (a web search, priced per search apart from the tokens). Calls to external APIs outside the layer (France Travail, the French company register, the job boards, contact enrichment with its credit cost) go through a recording fetch into the same report. The Back Office Assistant has its own task, `back_office_assistant`, routed like `coaching` (EU only) unless configured apart.

How the data rule of this ADR holds:
- `ai_usage`, `ai_tool_usage` and `external_api_usage` carry no Candidate id and no text, payload or query string: aggregates of no one, outside the data export, kept 24 months.
- What each call said goes to a separate AI Message Log (`ai_message_log`), personal data: kept 30 days in our EU database, tied to the Candidate (`ON DELETE CASCADE`, in their data export), read by super-admins only, every view written to the Back Office Audit. Keys and anything shaped like a credential are scrubbed before storing, off the call's stack, and each text is capped. A call whose Candidate no longer exists keeps no log. The stdout line never carries it.
- Recording never fails nor delays a call: the layer does not wait for the usage log, and a failed insert is only warned about.

Web search calls are AI-layer calls: their per-search fee is reported as the model's `web_search` tool, not as an external API, so it is counted once.
