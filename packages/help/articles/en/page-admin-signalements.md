---
kind: page
audience: administrator
topic: candidats
title: Feedback (Signalements)
synonyms: [feedback, signalements, signalement, bug, idea, question to the team, candidate feedback, to handle, new, seen, handled, team's reply, support]
route: /admin/signalements
---
Feedback (Candidates menu) lists the bugs, ideas and questions Candidates send from the app, oldest first. The number « to handle » shows next to the section's name for whoever can handle them. Feedback sent with the notice « An AI tool may read your message to help us handle it. » is also read, anonymised, by the feedback triage agent, with an agent key (« Agent keys » tab of Settings); the rest is read by the team only. A status set by the agent shows « seen by triage-beta », after its key's name.

The type is « Bug », « Idea » or « Question ». A question arrives when the help or the AI Coach did not satisfy the Candidate: it carries a copy of their question and of the AI Coach's reply. The status is « New », « Seen » or « Handled ». Filter with « Filter by type » and « Filter by status » (« To handle » or « All »).

Each row shows the date, the message, the page it came from, the Jobbbox version, the browser, the language, the text size, the Candidate and their Plan. « Open » gives the whole feedback, its « Context », its status and « The team's reply ». Opening feedback does not change its status.

The Candidate sees the reply signed « L'équipe Jobbbox », never with your name, and a notification when the team replied or marked it « Handled ». A question is marked « Handled » only once replied to. Feedback cannot be deleted from the back office.

**Signalement triage.** For feedback sent with the AI notice, the triage agent proposes an issue or a draft reply; Jobbbox publishes the issue on GitHub, after taking out the Candidate's name, email and phone and checking it does not quote their message (« Candidate data in an issue » guardrail). The feedback's « Issues » card gives the issue number or numbers, with a link: seen by the team only, never by the Candidate. The issue carries only the feedback's id, never its text; deleting the feedback removes the link and leaves the issue.

**Ready to close.** When the fix of a linked issue is deployed in the environment the feedback came from (the Beta, or the promoted version for Production), the feedback becomes « Ready to close », together with every feedback linked to the same issue. Only the team sees this status: the Candidate keeps « Seen » or « New ».

**The draft reply.** The « Draft reply » card shows the draft « proposed by triage-beta » (the key's name), in the Candidate's language and its translation. Edit it, then « Send to the Candidate »: they receive the version in their language, signed « L'équipe Jobbbox », and the feedback becomes « Handled » with it, in one notification. « Save the draft » keeps it unsent; « Delete the draft » removes it. A refused idea, or a question without an issue, is sent as soon as its draft is ready. The agent never sends anything to the Candidate and never marks « Handled ».

Support and super-admins change the status and reply. Help editors see the questions only, without the Candidate's email or Plan. Each status change, each reply written and each draft sent are recorded in Administrator actions (who, when), without their words.

“Coaching content reports”, available to people allowed to handle feedback, also receives requests without an account. Every removal, suspension or keep decision requires a reason notified to the reporter and content owner. The reporter’s contact details and original explanation are not shared with the owner.
