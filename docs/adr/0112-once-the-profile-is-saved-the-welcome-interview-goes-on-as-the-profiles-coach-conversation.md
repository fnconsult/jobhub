# Once the Profile is saved, the « Entretien d'accueil » goes on as the Profile's Coach Conversation

#1053 (A7, under #1041) ends the « Entretien d'accueil » (ADR-0106) on « Et maintenant ? » and lets the Candidate keep talking to the AI Coach (decided with the product owner on 18/11/2026, #1044).

## Decision

- **« Et maintenant ? »** closes the thread after « Cela semble correct »: « Voir mes offres à traiter » (`routes.jobSearches(id)`, primary, focused) and « Continuer vers mon profil », then one line opening the Coach Panel's help. The other features are presented in the help, not on this page.
- **Once saved, the page is the Profile's own Coach Conversation** (`CoachConversationPage`, Subject: the Profile), with the onboarding thread kept above it. A free message goes to `POST /api/coach` and gets a real reply, saved and shown again on the Profile's page. The scripted reply (`newProfile.savedOnly`) is removed.
- **The interview itself is still not a Coach Conversation** (ADR-0106): only what follows « Cela semble correct » is. Its welcome panel is not shown twice (`continues`).
- **The offers link is not filtered by Profile**: the Offer box does not filter by Profile today. Filtering is a follow-up.

## Considered Options

- **Keep the scripted reply**: the Candidate asks a question at the moment of highest interest and gets a canned answer.
- **Redirect to the Profile's page to chat**: loses the thread the Candidate has just built and hides the two actions.
