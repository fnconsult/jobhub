---
kind: tutorial
audience: administrator
topic: fournisseurs-et-tools
title: Load a test version of the extension
synonyms: [extension, test version, latest version, extension version, zip, beta, chrome-beta, unpacked, load unpacked, developer mode, chrome://extensions, github, releases, extension-v, test the extension]
---
Before it is published on the Chrome Web Store, an administrator can load in Chrome the latest version of the extension, the one the server serves. Candidates do not see this block.

1. In My account, open « Tools ». Under the Chrome Web Store button, the « Latest version of the extension » block gives the « Extension version » and the « API version served ».
2. Click « See the versions on GitHub ». The page opens in a new tab; the repository is private: you need access to it.
3. In the `extension-v` release of this extension version, download the zip the block names: `-chrome-beta.zip` on the Beta (tied to staging.jobbbox.ai), `-chrome.zip` in Production. Unzip it.
4. Open chrome://extensions and turn on « Developer mode ».
5. Click « Load unpacked » and choose the unzipped folder.

An extension loaded this way does not update itself: do it again for each new version. If the server no longer serves its API version, the extension asks to be updated.
