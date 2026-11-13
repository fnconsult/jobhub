---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Load a test version of the extension
synonyms: [extension, test version, extension ID, EXTENSION_ORIGINS, does not recognise, latest version, extension version, zip, beta, chrome-beta, unpacked, load unpacked, developer mode, chrome://extensions, download the zip, test the extension]
---
Before it is published on the Chrome Web Store, an administrator can load in Chrome the latest version of the extension, the one the server serves. Candidates do not see this block.

1. In My account, open « Tools ». Under the Chrome Web Store button, the « Latest version of the extension » block gives the « Extension version », the « API version served » and the « Extension ID ». If it shows « This server does not recognise this zip yet », add the origin it gives to the EXTENSION_ORIGINS deployment setting and redeploy before going on: otherwise the loaded extension shows « Jobbbox does not recognise this installation of the extension » on every capture.
2. Click « Download », followed by the zip's name: `-chrome-beta.zip` on the Beta (tied to staging.jobbbox.ai), `-chrome.zip` in Production. The server provides it itself: no GitHub access is needed. Unzip it.
3. Open chrome://extensions and turn on « Developer mode ».
4. Click « Load unpacked » and choose the unzipped folder.

The zip keeps the same ID whatever folder you unzip it into: once the origin is added, each new version is recognised. An extension loaded this way does not update itself: do it again for each new version. If the server no longer serves its API version, the extension asks to be updated. If the block says this server serves no extension zip, it is a development server: only deployments carry one.
