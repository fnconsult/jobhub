---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Load a test version of the extension
synonyms: [extension, test version, extension ID, EXTENSION_ORIGINS, does not recognise, automatic outside production, listed, latest version, extension version, zip, beta, chrome-beta, unpacked, load unpacked, developer mode, chrome://extensions, download the zip, test the extension]
---
Before it is published on the Chrome Web Store, an administrator can load in Chrome the latest version of the extension, the one the server serves. Candidates do not see this block.

1. In My account, open « Tools ». Under the Chrome Web Store button, the « Latest version of the extension » block gives the « Extension version », the « API version served » and the « Extension ID ». It also says whether this server recognises this zip, and why: on the Beta, it recognises it automatically, with nothing to add. In Production, it recognises it only if its origin is listed in the EXTENSION_ORIGINS deployment setting: if it shows « This server does not recognise this zip yet », have the origin it gives added and the environment redeployed before going on, otherwise the loaded extension shows « Jobbbox does not recognise this installation of the extension » on every capture. The link to Settings › Environment shows the same.
2. Click « Download », followed by the zip's name: `-chrome-beta.zip` on the Beta (tied to staging.jobbbox.ai), `-chrome.zip` in Production. The server provides it itself: no GitHub access is needed. Unzip it.
3. Open chrome://extensions and turn on « Developer mode ».
4. Click « Load unpacked » and choose the unzipped folder.

The zip keeps the same ID whatever folder you unzip it into: once it is recognised, each new version is too. An extension loaded this way does not update itself: do it again for each new version. If the server no longer serves its API version, the extension asks to be updated. If the block says this server serves no extension zip, it is a development server: only deployments carry one.
