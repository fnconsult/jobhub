# The AI disclosure is a flag on the Coach Conversation, not a message

The AI Act (art. 50(1)) requires the AI Coach to tell the Candidate it is an AI (#324). We decided that the **AI disclosure** is fixed text shown by the Coach Panel, recorded as `coach_conversation.ai_disclosure boolean NOT NULL DEFAULT false`, set to true on every new conversation.

## Considered Options

- **A saved first message**: would put it in the AI Coach's history and message window, count it in the Coach Message Cost, and change every existing message array and test.
- **An AI-generated first message**: costs a call and Plan Quota before the Candidate has asked anything, and its wording could drift from what counsel approved.

## Consequences

- No AI call, no Plan Quota use, no Coach Message Cost; the disclosure is never sent to the AI Coach. Its instructions separately tell it to say it is an AI when asked.
- Conversations saved before the flag keep `false` and their old welcome; they are not rewritten.
- The Data export lists the disclosure neither as a message nor as a field. If counsel wants it shown, add `aiDisclosure` to the export.

## Amendment (2026-11-02): a welcome panel the Candidate can close for good

Decided by the product owner. The AI disclosure opens the conversations' **welcome panel**, with the page's Introduction and the help. The Candidate can close the panel with its ✕, and it is then never shown again, on any device. This is recorded on the account in `coach_welcome_closed (candidate_id, closed_at)` and listed in the Data export as `coachWelcome.closedAt`. After that, the « Coach IA » badge by the message box, which is always shown, opens the same panel in a dialog, AI disclosure included.

- `coach_conversation.ai_disclosure` still says which conversations offered the disclosure. A conversation started after the panel was closed is still flagged: the disclosure is one click away on the badge.
- Whether a badge one click away is enough for art. 50(1) once the panel is closed is for counsel to confirm.
