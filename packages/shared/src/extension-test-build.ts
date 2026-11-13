/**
 * The test zip's fixed extension id (2026-11-13 regression). An Administrator loads the zip Outils serves (#989)
 * unpacked, before the store review, and Chrome derives an unpacked extension's id from the folder it was loaded from:
 * each new folder, a new id, a new `chrome-extension://<id>` origin, which EXTENSION_ORIGINS does not list. The web
 * app then refuses every call that acts with the Candidate's session (403), the Capture and the error report included,
 * while reading the session still works: « Connecté », and « Cette page ne peut pas être capturée ».
 *
 * The test zips apps/web/Dockerfile builds carry this public key as the manifest's `key`, so Chrome gives them this one
 * id wherever they are unpacked. Outside Production the web app trusts it with no .env change; Production trusts it only
 * when EXTENSION_ORIGINS lists it, since this key is public (apps/web/src/auth/extension-origins.ts, ADR-0033). Only the public key: loading unpacked needs nothing else, and no .crx is signed with it.
 * The store zips (extension.yml) carry no `key`: the Chrome Web Store refuses one that is not its listing's, and the
 * listing's own id is listed in EXTENSION_ORIGINS beside this one.
 */
export const TEST_BUILD_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1lMr2woWCHEePowA3z/r9ZmSVI0FtW9FUDmvdrIwjJLCxbdpYVtUfwUmFXz+8W6nyAwnXij2jrnR7990tdaBFM40U+T41ymp2SIisQEOGigPc8iv1o/bG4hLU/3ipUAtUZWhNBhoYeyzdGLjD9f4n61pL7QT1yCOMdxbOlDFlLGqYq7AHdFqF2oKpskMXsO1OG+yQr6eNIsq49yz5W4bbSQRzioop9kv4D9LQXdrF4j8katE4KBzZlxozBAla2OyWAraqkv+AkwocnbL5PIJWMUDLmBaPwQfGQzuJT4uzxgHllmvPKSsEfux2GYsRQikNzJYuI5QSgzxgZambbX3IQIDAQAB";

/** The id Chrome gives an extension whose manifest carries TEST_BUILD_PUBLIC_KEY (`extensionIdOfKey`). */
export const TEST_BUILD_EXTENSION_ID = "ebaaajbdddeihlmmdcahpembpofcmbml";

/** The test zip's origin: trusted outside Production, and in Production once EXTENSION_ORIGINS lists it. */
export const TEST_BUILD_EXTENSION_ORIGIN = `chrome-extension://${TEST_BUILD_EXTENSION_ID}`;
