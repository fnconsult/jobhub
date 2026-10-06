# TypeScript monorepo

The web app, the browser extension and the future mobile apps share domain types, the API client and translations, so everything lives in one TypeScript monorepo:
- web: Next.js
- extension: Chrome MV3 built with WXT
- mobile, later: Expo / React Native
- database: Postgres
- background job runner: crawling, Job Offer re-checks, Job Digests, Follow-ups
- payments: Stripe
- AI providers: Anthropic, Mistral, OpenAI, Perplexity, behind one layer (ADR-0007)
- interface translation: i18next, with French as the default locale

Authentication is passwordless (magic link + Google, plus Apple when the iOS app ships), because the senior audience produces more support tickets with passwords.
