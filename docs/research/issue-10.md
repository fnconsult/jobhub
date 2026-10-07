# Research for issue #10: Extension capture and Guest scoring

Scope: only the external facts needed to implement issue #10. Sources are first-party docs, fetched 2026-10-08.

## 1. schema.org JobPosting detection

Source: https://developers.google.com/search/docs/appearance/structured-data/job-posting

- Google documents JSON-LD in `<script>` tags as the format. Microdata/RDFa also exist in the wild; detection should parse `script[type="application/ld+json"]` first.
- Required by Google: `title`, `description` (HTML), `datePosted`, `hiringOrganization`, `jobLocation`. Recommended: `baseSalary`, `employmentType`, `validThrough`, `jobLocationType` (`TELECOMMUTE`), `applicantLocationRequirements`, `directApply`, `identifier`.
- Google asks for one JobPosting per dedicated page, not on list pages. So a JobPosting on a page is a good signal of a single offer; a list page should not trigger the badge by itself.
- Implication: real pages vary (arrays, `@graph`, missing fields, remote jobs without `jobLocation`). The parser must be tolerant: treat only `title` + `description` + `hiringOrganization` as the minimum, and fall back to manual "Capturer cette page" otherwise. (Implementation inference, not a source claim.)
- `description` is HTML: strip to text before scoring.

## 2. Capture in the person's own browser (activeTab)

Source: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab

- `activeTab` plus the `scripting` permission allows `scripting.executeScript()` on the current tab after a user gesture (action click, context menu, keyboard command), without broad host permissions. Access ends on navigation or tab close. `chrome://` pages are excluded.
- Fits the manual "Capturer cette page" fallback and ADR-0002 (no server-side scraping): the page is read in the user's browser and only extracted content is sent to our API.
- Automatic detection (badge on page load) cannot rely on activeTab, since no gesture has happened. It needs a content script with host match patterns (persistent site access) or `optional_host_permissions` requested at runtime. Broad `<all_urls>` has store-review and trust cost; a list of known job-board patterns plus manual capture elsewhere is the lower-permission design. Decision for the implementer.
- Current `apps/extension/wxt.config.ts` has `permissions: []` and only the web origin in `host_permissions`; both `activeTab`/`scripting` and any content-script matches would be new.

## 3. Chrome and Edge from one MV3 build

Source: https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension

- Edge supports the Chrome extension APIs and manifest keys; a Chrome extension ports with minimal changes: check APIs against Edge's supported list, remove `update_url`, do not use "Chrome" in name/description, sideload-test.
- Publishing is a separate submission on Microsoft Edge Add-ons (developer registration required). One build, two store listings.

## 4. MV3 constraints for sending data to our backend

Source: https://developer.chrome.com/docs/extensions/develop/migrate/improve-security

- All executable code must ship in the package; no remote JS/Wasm. Calling our own web service for data is allowed. So scoring runs server-side via the API, and detection rules must be bundled (rule updates ship with extension releases, or as JSON data only).
- Extension page CSP `script-src` is limited to `'self'`, `'none'`, `'wasm-unsafe-eval'` (plus localhost when unpacked).

## 5. GDPR points behind "Guest data deleted within 24h" (ADR-0003)

Source: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679 (Regulation (EU) 2016/679)

- Art. 5(1)(e) storage limitation: keep identifiable data no longer than necessary. A hard 24h maximum is our own policy and is stricter than the law requires; the deletion job must actually enforce it (including backups/logs that hold CV text).
- Art. 6(1): a lawful basis is needed for the CV. Consent or pre-contractual/legitimate interest are candidates; which one applies is a legal call, not settled here.
- Art. 13: at collection the Guest must be told controller identity, purposes, legal basis, retention period (24h), and rights. So the upload step needs a short notice stating the 24h retention.

## Open questions for the owner

- Which job boards count as "major" for automatic detection, and which match patterns that implies (permission scope decision above).
- Lawful basis wording for the Guest notice (legal review).
- Whether Edge Add-ons and Chrome Web Store submissions are in scope for this issue or a later release task.
