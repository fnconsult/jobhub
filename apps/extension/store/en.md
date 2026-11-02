<!--
The Jobbbox extension's Chrome Web Store listings (#563, ADR-0063), in English: the French text, fr.md, prevails. Copy
them into the Chrome Web Store dashboard, field by field, when the text changes (docs/ops/extension.md). Labels in « »
are the interface's, word for word.
-->

# Public listing

- **Visibility**: public
- **Name**: Jobbbox (`__MSG_extName__`, `public/_locales/en/messages.json`)
- **Build**: `jobbbox-extension-X.Y.Z-chrome.zip`, tied to Production (`https://jobbbox.ai`)
- **Category**: Productivity
- **Language**: English (localised listing; French is the default, `fr.md`)
- **Privacy policy**: https://jobbbox.ai/legal/confidentialite
- **Support URL**: https://jobbbox.ai/aide/extension (Help Centre, « The extension » topic)
- **Website**: https://jobbbox.ai

## Summary (132 characters at most)

Capture a job offer and prepare your application with your Jobbbox coach.

## Description

The Jobbbox extension saves into Jobbbox the job offer you are reading on a job site, and works out its match score with your CV, without copying and pasting.

On a job offer's page, it adds the « Analyse this offer » button. You can also open it in the browser's side panel and click « Capture this page ».

Without an account: upload your CV, the extension works out the offer's Match Score, then deletes everything within 24 hours.

With a Jobbbox account: « Sign in », in the extension, and the offer joins your applications, where your coach helps you prepare a tailored CV and a cover letter.

On job sites, the extension recognises a job offer in your browser; it sends a page to Jobbbox only when you click. To see « Analyse this offer » on employers' career sites too, tick « Detect job offers on every site » in the panel: your browser then asks for your permission.

Help: https://jobbbox.ai/aide/extension
Privacy policy: https://jobbbox.ai/legal/confidentialite

## Single purpose

Save into Jobbbox the job offer being read and work out its match score with the person's CV.

## Permission justifications

- **activeTab, scripting**: read the page of the job offer the person is viewing, when they click « Capture this page » or « Analyse this offer ». The job sites' content script recognises an offer to show that button, without sending the page.
- **storage**: keep the session of a person without an account, in memory, and the list of job sites Jobbbox sends it.
- **alarms**: delete the session of a person without an account on time, within 24 hours.
- **sidePanel**: the extension opens in the browser's side panel, beside the offer.
- **Host permissions (jobbbox.ai and job sites)**: share the person's session on jobbbox.ai, and read a job site's offer, including when it is shown in a frame of another page.
- **Optional host permission (all sites)**: asked only if the person ticks « Detect job offers on every site ».
- **Remote code**: none. All the code is in the package.

# Beta listing

- **Visibility**: unlisted (reachable by its link, for testers)
- **Name**: Jobbbox (beta) (`__MSG_extNameBeta__`), with the orange icon marked β
- **Build**: `jobbbox-extension-X.Y.Z-chrome-beta.zip`, tied to the Beta (`https://staging.jobbbox.ai`)
- **Category**: Productivity
- **Privacy policy**: https://staging.jobbbox.ai/legal/confidentialite
- **Support URL**: https://staging.jobbbox.ai/aide/extension
- **Website**: https://staging.jobbbox.ai

## Summary (132 characters at most)

Beta version of the Jobbbox extension, tied to the Beta: to try what is new before it is published.

## Description

Beta version of the Jobbbox extension, for testers only. It is tied to the Jobbbox Beta (staging.jobbbox.ai), not to the public site: use it with your account on the Beta.

For everyday use, install the public Jobbbox extension.

It does the same as the public extension: on a job offer's page, « Analyse this offer » or « Capture this page » saves it into Jobbbox and works out its match score with your CV.

Help: https://staging.jobbbox.ai/aide/extension
Privacy policy: https://staging.jobbbox.ai/legal/confidentialite

## Single purpose and permission justifications

The same as the public listing's, with staging.jobbbox.ai in place of jobbbox.ai.
