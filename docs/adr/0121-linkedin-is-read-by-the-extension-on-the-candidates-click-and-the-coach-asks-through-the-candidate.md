# LinkedIn is read by the extension on the Candidate's click, and the Coach asks for it through the Candidate

Decided in #1164 (relates to ADR-0119, #1160).

- **Who reads.** The extension, in the Candidate's own browser and session, only on their click « Lire cette page LinkedIn » (`activeTab`, no new permission). Jobbbox's server never requests linkedin.com: LinkedIn's terms apply to the Candidate's account, and the Side Panel says so.
- **What.** A job offer, a company page or its people page; never a profile (`/in/`), the feed or a people search. Per person, name, role and company only; « Membre LinkedIn » and duplicates dropped, at most 50. The rules are shared (`packages/shared/src/linkedin-reading.ts`) so the extension and the server apply the same ones.
- **Where it goes.** People are filed as « LinkedIn » contacts of each Application at that employer and each Target Company of that name. With neither, nobody is kept: the reading records only a count, and the coach proposes the Target Company first.
- **The Coach asks through the Candidate.** The web app has no channel to the extension. `read_linkedin_page` returns the last reading of the past 30 minutes, else tells the coach to ask the Candidate to open the page and click. A direct request from the Coach Panel would need `externally_connectable` in the manifest: not added.
- **Switched off.** `LINKEDIN_READING_ENABLED` is off by default; the constant `LINKEDIN_READING_IN_PRODUCTION` is false: never in Production until the Legal Review (#1160) is done.
