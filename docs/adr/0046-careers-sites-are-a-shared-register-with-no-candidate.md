# Careers sites are a shared register keyed by company, with no Candidate

Target Companies (#406) are visited for each Profile, and finding a company's careers page costs a web search. The same company is a Target Company for many Candidates. Research: `docs/research/issue-406.md`.

- **A shared register**: `company_careers_site` holds one Careers site per company, keyed by `siren:` from the SIRET, else `name:` and the normalised name. It holds public facts only (the company's key, the site's address and kind), no Candidate and no Profile.
- **Found once**: from the results of the « job title + company name » search a run does anyway, not a separate lookup. Accepted: a Greenhouse, Lever or Ashby board whose name carries the company's name, a Welcome to the Jungle company page, the careers section of a site whose host carries the company's name. A name whose distinctive words are all under 4 letters is never matched.
- **Per Profile, the rest**: the list of La Bonne Boite companies is kept per Profile (`target_company`), refreshed at most monthly for the same title and first place, deleted with the Profile and exported with the Candidate's data. Only the job and the area are sent to La Bonne Boite and ROMEO (ADR-0007).

## Considered Options

- **A careers site kept per Profile**: the same search repeated for each Candidate, for nothing personal.
- **A separate careers-site lookup**: another search per company, when the results already show it.
- **A third-party company-to-ATS directory**: a paid dependency, stale boards.
