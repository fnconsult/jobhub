# No LinkedIn integration of any kind

LinkedIn's API does not give third parties full profile or job data, and scraping it breaks its terms of use and creates GDPR exposure. We dropped LinkedIn entirely: no "Sign in with LinkedIn", no profile import, no PDF-export import, no server-side job search. Candidates onboard by uploading a CV (PDF/Word) or through the Onboarding Questionnaire. LinkedIn Job Offers enter the system only when the Candidate captures them with the browser extension, in their own browser.

## Amended by ADR-0119 (2026-11-26)

The browser extension may read a LinkedIn page the Candidate opened or named, in their own browser and on their request. Of each person it keeps only the name, the role and the company. It may also send a LinkedIn invitation or message from the Candidate's own session, on their click on a card: one person per card, at most 20 per day. Jobbbox's server still never reads LinkedIn. There is still no background collection, no profile import and no « Sign in with LinkedIn ».
