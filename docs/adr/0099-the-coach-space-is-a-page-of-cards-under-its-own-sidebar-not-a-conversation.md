# The Coach space is a page of cards under its own Sidebar, not a conversation

Status: accepted (map #841; #843, #852, prototype #856 variant A)

ADR-0070 made the conversation the page for Candidates and left the Coach space out. The Coach space grows from one page (sessions to date, Candidates under Coach Access) to a daily tool.

- **Its own Sidebar**: Aujourd'hui, Mes Candidates, Mes séances, Disponibilités, Profil public, Revenus, Contrat, Aide; a drawer under 768 px, in the web app and the Jobbbox app.
- **Each page is a single column of cards read top to bottom** (variant A of #856), in the comfortable Density by default, light and dark. No AI Coach conversation for the Human Coach in v0.
- **Aujourd'hui**: today's and tomorrow's sessions (« Rejoindre » ten minutes before), what needs action, recent Candidates. **A Candidate's page** gathers their sessions with this coach and the coach's Private Coach Notes, and, under Coach Access only, their Profiles, Applications, Tailored Documents and Coach Reviews; never their Agenda or Coach Conversations.
- **The Coach Page** (public profile) is edited by the Human Coach and shown to Candidates only once an Administrator has approved each change; no reviews in v0 (L111-7-2).
- **Coach Earnings**: per month, sessions held, amount collected, Commission, payout and its date, refunds, invoices.
- **An Association has a space of the same kind**: its Human Coaches, its Coaching Offers, its earnings, never its coaches' Candidates.
- **Notifications** by email and Push notification (ADR-0089), and a morning summary the coach can switch off.

## Considered Options

- **List and detail in two columns** (variant B of #856): kept context between items, but rejected by the product owner for a simpler page read top to bottom.
- **The conversation as the page, as for Candidates**: nothing for an AI Coach to do for the coach yet.
