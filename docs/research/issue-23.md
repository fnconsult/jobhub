# Issue #23: contact-enrichment providers (Lusha, Kaspr, Apollo)

Sources checked 2026-10-08, vendor documentation only. Items marked UNCONFIRMED could not be verified from a primary source and must be checked before the adapter is written.

## Summary for the interface design

- Two-step flow on Lusha and Apollo: search (find people by company + title) then enrich/reveal (get email/phone). Search and reveal have different costs.
- Kaspr: only profile-level enrichment is documented (needs a LinkedIn URL). No search by company/title found. A Kaspr adapter probably cannot implement "find people by company + role" natively.
- The interface should therefore split `findPeople(companyDomain, roles)` from `getContactDetails(personRef)`. An adapter may declare `findPeople` unsupported (Kaspr).
- Reveal costs vendor credits: call it only when the Candidate actually opens a contact, and count the Plan Quota on that action.

## Lusha

Docs: https://docs.lusha.com (API v3)
- Base `https://api.lusha.com/v3/`, HTTPS, JSON. Auth: `api_key` header.
- Search by company/title: `POST /v3/contacts/prospecting` (https://docs.lusha.com/api-reference/prospecting/prospecting-contacts).
  - Body: required `pagination` {page, size 10-100} and `filters` {contacts, companies} each with include/exclude.
  - Contact filters: `jobTitles`, `jobTitlesExactMatch`, `seniorityIds` (integers; map via the Filters endpoint), `departments`, `countries`.
  - Company filters: `domains`, `names`, `linkedinUrls`. Option `maxContactsPerCompany` (1-20).
  - Result: `id`, `firstName`, `lastName`, `jobTitle`, `company`, `socialLinks`, `has`, `canReveal` (fields + credit cost), `billing.creditsCharged`.
  - Each returned result is charged credits at search time.
- Identifier lookup: `POST /v3/contacts/search` with `contacts[]` (firstName, lastName, companyDomain, linkedinUrl, email). Does not spend credits.
- Reveal emails/phones: "Enrich Contacts" with the contact `id`; spends credits. Full schema NOT on the pages read: UNCONFIRMED.
- Rate limits: per minute/hour/day by plan; headers `x-minute-requests-left`, `x-hourly-requests-left`, `x-daily-requests-left`; `429` when exceeded, `402` when credits are insufficient.
- Option `excludeDnc` exists on prospecting (useful for compliance).

## Apollo

Docs: https://docs.apollo.io
- Base `https://api.apollo.io/api/v1`. Auth: `x-api-key` header (or OAuth bearer for partners).
- Search: `POST /mixed_people/api_search` (https://docs.apollo.io/reference/people-api-search).
  - Filters as query parameters: `person_titles[]` (similar titles included unless `include_similar_titles=false`), `person_seniorities[]`, `q_organization_domains_list[]` (up to 1,000), `page`, `per_page` (max 100).
  - 0 credits. Does NOT return emails or phones; returns `id`, `first_name`, `last_name_obfuscated`, `title`, `has_email`, `has_direct_phone`, `organization`.
  - Rate limit example in docs: 600 calls/hour; actual limits depend on plan. 401/403/422/429 errors. Free accounts may have eligibility restrictions.
- Enrichment: `POST /people/match` (https://docs.apollo.io/reference/people-enrichment).
  - Inputs: `id` (from search) or name/domain/linkedin_url.
  - Returns `person` with `email`, `email_status`, `title`, `linkedin_url`, `match_confidence` (high/medium/low/none).
  - `reveal_personal_emails` is not returned for people in GDPR-compliant regions (docs statement), so French/EU contacts may have no personal email.
  - Phone reveal is asynchronous: needs HTTPS `webhook_url` or `poll_only=true` with `request_id`. Phone adds 8 credits; base 1-9 credits per person; no data found = 0 credits.
  - Consequence: v1 should skip phone, or handle async polling in the adapter.

## Kaspr

Docs: https://www.kaspr.io/api links to a Stoplight-hosted reference that could not be fetched (docs.kaspr.io does not resolve). Everything here is from the marketing page and help center; treat as UNCONFIRMED.
- Enrichment from a LinkedIn profile URL (the page also mentions a LinkedIn ID; inconsistent). Returns phone, direct email, work email, job title, company.
- No company/title search documented.
- API is a paid feature (Starter basic, Business advanced, Organization premium). Credits: one export credit per successful call plus per data type.
- Auth scheme, endpoint paths and rate limits: not found. Plan-dependent limits per integrator guides.
- Needs a LinkedIn URL as input, so Kaspr can only enrich people found by another source (e.g. a Lusha/Apollo search), not discover them.

## Compliance points for the issue

- The "DPA signed" flag in the issue is the right gate; Apollo's own docs withhold personal emails for GDPR-region people, confirming providers treat EU data differently.
- Store provider and retrieval date per contact (already in the acceptance criteria). Consider storing the provider's person id to answer data-subject requests.
- Lusha exposes `excludeDnc`; use it.
- Not verified here: each provider's DPA terms, EU data hosting, lawful-basis wording. Human step before go-live, as the issue states.

## Open questions for the human

1. Kaspr: confirm API reference access and whether any search exists, else keep it enrich-only.
2. Lusha: obtain the Enrich Contacts schema and seniority ID mapping.
3. Decide whether phone numbers are in scope (Apollo async, 8 extra credits).
