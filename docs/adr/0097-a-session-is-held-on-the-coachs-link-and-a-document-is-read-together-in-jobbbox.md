# A Coaching Session is held on the Human Coach's own link, and a document is read together in Jobbbox

Status: accepted (map #841; #845, #854)

The product owner wanted calls inside Jobbbox and links to third-party tools. Research #845 priced integrated video (LiveKit, Daily, Whereby…) and found that the value only Jobbbox can add is reading the Candidate's own documents together.

- **In v0 the session is held on a link**: the Human Coach's Zoom, Google Meet, Teams or other link, or a phone number. Jobbbox recognises the tool and shows « Rejoindre sur … » ten minutes before the start. Creating the meeting through the coach's account comes later.
- **Shared Reading**: during the session the Candidate opens a Tailored Document or their CV for the Human Coach, who sees the same page live in Jobbbox, even without Coach Access, only that document and only during the session; the Candidate can stop it. The coach can present a PDF (ADR-0067, ADR-0068). Nothing is annotated or kept on the coach's side.
- **Screen sharing stays in the third-party tool**; Jobbbox has none.
- **No new recipient in v0.** The B2B contract (#518) forbids recording or AI note taking in the third-party tool without the Candidate's consent.
- **Integrated video comes in the next phase**, with LiveKit (Expo plugin, EU self-hosting possible), as it must precede live Masterclasses. Its provider is a recipient (ADR-0064), and its live captions an AI route to keep in the EU.

## Consequences

- A Coaching Session is a remote session, by video or by phone, no longer only a video meeting.
