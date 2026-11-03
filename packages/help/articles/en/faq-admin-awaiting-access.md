---
kind: faq
audience: administrator
topic: fournisseurs-et-tools
title: Why is a tool « Awaiting access »?
synonyms: [awaiting access, access refused, france travail, offres d'emploi api, la bonne boite, romeo, authorisation, tool unavailable, source unavailable, en attente d'accès]
---
A tool is « Awaiting access » when its key is valid but its provider refuses it an API at the latest connection test. Today, that is France Travail's case until the Offres d'emploi API is opened to the application.

In Tools, it shows « Unavailable: access refused by France Travail ». In the « Sources » tab of Settings, the source shows « Awaiting access »: job searches go on without it, with the other sources.

To know which API is missing, open France Travail's sheet in the « Sources » tab: the « France Travail API access » table gives each API's « State » (« ok », « access refused » or « error ») at the latest test. Ask for access to the refused API in your France Travail partner space; once granted, a super-admin clicks « Test … » on the sheet. Once the test passes, the tool is back to « Configured », with nothing else to change.
