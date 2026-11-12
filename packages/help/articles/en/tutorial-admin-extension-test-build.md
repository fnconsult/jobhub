---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Load a test version of the extension
synonyms: [extension, test version, latest version, extension version, zip, beta, chrome-beta, unpacked, load unpacked, developer mode, chrome://extensions, download the zip, test the extension]
---
Before it is published on the Chrome Web Store, an administrator can load in Chrome the latest version of the extension, the one the server serves. Candidates do not see this block.

1. In My account, open « Tools ». Under the Chrome Web Store button, the « Latest version of the extension » block gives the « Extension version » and the « API version served ».
2. Click « Download », followed by the zip's name: `-chrome-beta.zip` on the Beta (tied to staging.jobbbox.ai), `-chrome.zip` in Production. The server provides it itself: no GitHub access is needed. Unzip it.
3. Open chrome://extensions and turn on « Developer mode ».
4. Click « Load unpacked » and choose the unzipped folder.

An extension loaded this way does not update itself: do it again for each new version. If the server no longer serves its API version, the extension asks to be updated. If the block says this server serves no extension zip, it is a development server: only deployments carry one.
