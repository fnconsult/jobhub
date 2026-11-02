# API Version : quand la monter

L'**API Version** (ADR-0063, #564, `CONTEXT.md`) nomme le contrat entre l'extension et le web app. Elle est déclarée une fois, `API_VERSION` dans `packages/shared/src/api-version.ts`. Le client de l'extension (`apps/extension/src/jobbbox-api.ts`, `job-sites.ts`, `candidate-session.ts`) l'envoie dans l'en-tête `Jobbbox-Api-Version` sur chaque appel ; le web app (`apps/web/src/api-version`, appelé par `src/proxy.ts`) sert la version courante et la précédente, et répond `426 Upgrade Required` avec le code `extension_outdated` à une plus ancienne, ou à un appel d'une extension sans en-tête : reconnu à son `Origin: chrome-extension://…` (POST) ou, sur un GET qui n'en porte pas, à `Sec-Fetch-Site: none` avec `Sec-Fetch-Mode: cors`. Le Side Panel affiche alors « Mettez à jour l'extension » avec un lien vers `EXTENSION_STORE_URL` (Paramètres), sans toucher à la Guest session. `/api/health` renvoie `apiVersion`.

Hors du contrat : `/api/health`, `/api/auth/*` (Better Auth), les webhooks Stripe (`/api/billing/webhook`) et Email intake (`/api/email-intake/inbound`), et les pages du web app, qui appellent les mêmes routes depuis leur propre origine sans en-tête.

## La règle

Monter `API_VERSION` d'un, et seulement alors, quand un changement du web app **casse une extension déjà installée** :

- une route que l'extension appelle disparaît, change d'adresse ou de méthode ;
- un champ que l'extension lit disparaît, change de nom, de type ou de sens ;
- un champ devient obligatoire dans ce que l'extension envoie ;
- un statut ou un code d'erreur que l'extension interprète change.

Ne pas la monter pour un ajout que l'extension installée ignore : nouvelle route, nouveau champ facultatif dans une réponse ou une requête, nouveau code d'erreur sur une route qu'elle n'appelle pas.

## L'ordre

1. Le web app sert d'abord **les deux** contrats : la nouvelle version N et l'ancienne N−1 (la garde le fait seule ; aux routes de garder le comportement d'avant pour une requête en N−1, lu dans `Jobbbox-Api-Version`).
2. Il est promu (`docs/ops/promotion.md`) avant que l'Extension Version qui parle N soit publiée sur les stores : une extension plus récente que le web app n'est jamais invitée à se mettre à jour, la garde la laisse passer.
3. Monter N une seconde fois coupe les extensions en N−1 : attendre que les stores aient servi la version en N à presque tous (mise à jour automatique des navigateurs, en général sous quelques jours).
