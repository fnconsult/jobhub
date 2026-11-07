# Session notes come without AI first; recording, transcripts and summaries need both consents and stay in the EU

Status: accepted (map #841; #846, #847, #850, #855)

Nothing exists during or after a Coaching Session today. Recording a career conversation touches special-category data (GDPR art. 9), criminal law on recordings (C. pén. 226-1) and the AI Act, so the rules are set now, before any of it ships.

- **v0, no AI**: the Human Coach keeps Private Coach Notes per Candidate and per session, never shown to the Candidate on screen, and writes a Session Report on a template (what was covered, next steps, resources), published in the Candidate's Coach Conversation for that session. Next steps may become Action Cards, only through Coach Actions that copy no text (ADR-0077).
- **Jobbbox is the controller, the Human Coach its processor** (GDPR art. 28) for notes, reports and, later, recordings. Private Coach Notes are in the Candidate's Data export (right of access), and the coach is told so; deleted with the Candidate's account, unreadable once the coach is retired.
- **Next phase, Session Recording**: never by default; explicit consent of both participants for each session, a visible indicator, either can stop at any time; a DPIA before it opens (the CNIL list names professional reintegration support). Viewable on the web only, never in the Jobbbox app (Google Play's exception for one-to-one live services, #850).
- **Next phase, Session Transcript and Session Summary**: transcription and summary run on an EU-only AI task (Mistral, `api.eu.mistral.ai`, training refused and zero retention asked); Redaction does not protect a spoken session, so no route outside the EU. The Human Coach reviews a summary before it is published; it is marked as generated from its launch (AI Act art. 50(2), #337); it infers no emotion (art. 5(1)(f)) and never assesses the Candidate. Audio deleted after transcription, transcript after 30 days, summary kept as long as the Candidate keeps it. Included in the paid session, against no Plan Quota.

## Consequences

- Amends ADR-0007: an EU-only route for spoken content, with no fallback outside the EU.
- New entries in the privacy register, a privacy policy version and the B2B contract (#518) when the next phase opens.
