<!--
The Jobbbox app's listings on the App Store and Google Play (#708, ADR-0076), in English: the French text, fr.md,
prevails. Copy them into App Store Connect and the Play Console, field by field (docs/ops/mobile.md, « Fiches des
stores et première soumission »); store.config.json carries the App Store's fields for `eas metadata:push`. Labels in
« » are the interface's, word for word.

A DRAFT until the publishing entity exists: nothing is submitted. Each field waiting for its name carries
[ENTITÉ À CONFIRMER]; mobile.yml refuses a `production` build while that marker is in this folder. A field marked
"draft, #706" or "draft, #707" waits for that issue's Legal Review. Under each heading, the store's limit:
e2e/store-listings.e2e.test.ts checks it.
-->

# Both stores

- **App**: Jobbbox, `ai.jobbbox.app` (iPhone, iPad, Android; one app for candidates and human coaches)
- **Language**: English (US), `en-US`, a localised listing; French (France) is the default (`fr.md`)
- **Countries**: France, Belgium, Switzerland, Luxembourg, Canada
- **Price**: free, no in-app purchase
- **Category, App Store**: Business (`BUSINESS`), then Productivity (`PRODUCTIVITY`)
- **Category, Google Play**: Business; type: app
- **Website (marketing URL)**: https://jobbbox.ai
- **Support URL**: https://jobbbox.ai/aide (Help Centre)
- **Privacy policy**: https://jobbbox.ai/legal/confidentialite (draft, #706: the version covering the app must be in effect before the submission)
- **Account deletion (Google Play, required link)**: https://jobbbox.ai/aide/utiliser/faq-data-export-deletion (to check when entering it; in the app: My account, « My data », « Delete my account »)
- **Displayed publisher, seller, copyright**: [ENTITÉ À CONFIRMER]
- **Displayed contact email (Google Play, required)**: [ENTITÉ À CONFIRMER] (an address of the entity, read by a person)
- **To confirm before the submission**: in the description, the human coaches paragraph and the absence of in-app purchase (draft, #707), the data paragraph (draft, #706)
- **Screenshots**: `screenshots/`, in French; the English listing shows the default language's
- **Icon**: provisional, the word Jobbbox on the indigo accent (ADR-0053), `../assets/icon.png`

## Description (4,000 characters at most)

Jobbbox supports your job search after 40: an AI coach, your applications, your job searches and your agenda, on your phone and your tablet.

The app uses the same account as jobbbox.ai: what you do on one shows on the other. No password: you sign in with a link or a code sent by email.

Your AI coach
Write to it as in a conversation: prepare an interview, follow up with a recruiter, understand a job offer. The coach is an artificial intelligence, not a person: it says so at the start of every conversation. It proposes, you decide on every change. Like any AI, it can be wrong: read over what it writes.

Your applications
Each application has its own sheet: its status, its interviews, its match score with your profile. Add, move or cancel an interview. Open, share or download your tailored CV and your cover letter.

Your job searches
The offers found for you wait in a box: follow the ones you like, set the others aside. From another app, share a job offer to Jobbbox to save it.

Your agenda
Your interviews and sessions, day by day, to add to your device's calendar. Jobbbox does not read your calendar.

Human coaches
To talk to a person, book a session with a human coach, an HR professional selected by Jobbbox. The session is held by video, live and one to one.

And also
• The notifications you choose: new results, an interview reminder, a coach's review. Their text never names a company, a job or a person.
• Offline, you can read what you last looked at.
• App lock with your device's biometrics or passcode.
• Text follows the size set on your device, and so does the dark theme; the app works with your device's screen reader.
• In French and in English.

Your data
No advertising, no audience measurement, no ad tracking. You can download your data or delete your account at any time, in My account.

Help: https://jobbbox.ai/aide
Privacy policy: https://jobbbox.ai/legal/confidentialite

# App Store

## Name (30 characters at most)

Jobbbox

## Subtitle (30 characters at most)

Your AI coach for job hunting

## Promotional text (170 characters at most)

Your AI coach, your applications, your job offers and your agenda in your pocket. The same account as on jobbbox.ai, on iPhone and iPad.

## Keywords (100 characters at most, separated by commas)

job search,application,CV,resume,cover letter,interview,coach,jobs,career,recruiter,senior

## What's New in This Version (4,000 characters at most)

First version of the Jobbbox app on iPhone and iPad.

_Afterwards: the text `npm run store-whats-new -w @jobhub/help` takes from the Version's Release Note (docs/ops/mobile.md)._

# Google Play

## Title (30 characters at most)

Jobbbox

## Short description (80 characters at most)

Your AI coach, your job applications and your job offers, on your phone.

## Release notes (500 characters at most)

First version of the Jobbbox app on Android.

_Afterwards: `whatsnew-en-US`, written by `npm run store-whats-new -w @jobhub/help`._
