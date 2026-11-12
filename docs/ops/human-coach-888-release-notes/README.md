# Release Note fragments held for #888

The Human Coach epic (#867) is merged behind « Espace coach v2 » (`COACH_SPACE_V2`, ADR-0106), off by default: until it is
on, a Candidate sees nothing of it, so its fragments do not belong to the next Version's Release Note
(`docs/agents/documentation.md`).

They wait here. The PR of #888 that turns the setting on moves them back into `packages/help/releases/unreleased/`, renamed
after that PR (`<pr>.md`, `<pr>-2.md`… one file per kind), rereads each line against what ships, and the Promotion
assembles them as usual. The Help build reads only `packages/help/releases/`, so these files are not checked until then.
