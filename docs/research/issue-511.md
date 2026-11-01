# Issue 511 : faits Stripe pour la rétractation en ligne

Périmètre : seulement ce que #511 doit implémenter (annulation immédiate d'un abonnement, remboursement intégral, échec de remboursement). La base juridique (L221-21 al. 3, D221-5, L221-24, L221-25) est déjà dans `docs/research/issue-496.md` §3.2 (branche `research/issue-496`) et n'est pas refaite ici. Sources : documentation Stripe officielle, consultée le 2026-10-30 (version d'API affichée : `2026-10-28.endive`). Le SDK du dépôt est `stripe ^23.0.0` (`apps/web/package.json`).

## 1. Annuler tout de suite un abonnement

Source : https://docs.stripe.com/api/subscriptions/cancel

- `DELETE /v1/subscriptions/{id}` annule **immédiatement** ; le client n'est plus facturé. C'est l'équivalent exigé par l'issue (« pas de Scheduled Cancellation »), à l'opposé de `cancel_at_period_end`.
- Le statut devient `canceled`. L'objet reste ensuite quasi immuable (seuls `metadata` et `cancellation_details` se modifient).
- Paramètres : `invoice_now` (défaut `false`), `prorate` (défaut `false`), `cancellation_details` (objet ; l'exemple de réponse montre `reason: "cancellation_requested"`). Avec les défauts, **aucun crédit au prorata et aucune facture finale** ne sont créés : on peut donc annuler sans effet de bord comptable, puis rembourser soi-même le montant voulu.
- Par défaut, Stripe **arrête la collecte automatique des factures finalisées** du client à l'annulation. À vérifier : pas de facture ouverte à ce moment-là (le doc suggère de contrôler les factures impayées avant d'annuler).
- L'annulation **ne rembourse rien** : le doc ne mentionne aucun remboursement automatique. Le remboursement est un appel distinct (§2).
- `DELETE` est idempotent par nature ; le doc dit de ne pas envoyer de clé d'idempotence sur `GET` et `DELETE` (https://docs.stripe.com/api/idempotent_requests). Rappeler `DELETE` sur un abonnement déjà annulé : comportement non documenté sur cette page, à tester ou à éviter en lisant le statut d'abord.

## 2. Rembourser

Sources : https://docs.stripe.com/api/refunds/create, https://docs.stripe.com/refunds

- `POST /v1/refunds` avec `payment_intent` **ou** `charge`. Sans `amount`, remboursement total ; `amount` (plus petite unité monétaire) pour un partiel, plusieurs partiels possibles jusqu'au total. Rembourser plus que le reste, ou un paiement déjà remboursé en entier, **lève une erreur**.
- Le doc recommande de rembourser par PaymentIntent quand le paiement en vient.
- `reason` accepte `duplicate`, `fraudulent`, `requested_by_customer`. Pour une rétractation, `requested_by_customer` est le bon. Ne jamais mettre `fraudulent` (ajoute carte et e-mail aux listes de blocage Radar).
- `metadata` est libre : y mettre l'identifiant de notre enregistrement de rétractation pour retrouver le lien dans les webhooks.
- Remboursement uniquement vers le moyen de paiement d'origine. Les frais de traitement Stripe de la transaction initiale **ne sont pas rendus** (coût pour Jobbbox).
- Le remboursement est prélevé sur le solde Stripe disponible ; si insuffisant, un remboursement par carte reste **en attente** jusqu'à ce que le solde suffise (les autres moyens de paiement échouent).
- Délai côté client : 5 à 10 jours ouvrés selon la banque. Un remboursement émis peu après le paiement peut apparaître comme une **annulation** (`destination_details.card.type = "reversal"`) : le débit disparaît du relevé, sans crédit.
- Stripe envoie lui-même un e-mail de remboursement au client si l'option du Dashboard est activée et que le paiement est lié à un Customer avec e-mail. Cet e-mail **ne remplace pas** l'accusé de réception du Code de la consommation (support durable, contenu de la rétractation, date et heure) : il faut l'e-mail Brevo de l'issue. Décider si on désactive l'option du Dashboard pour éviter deux messages (réglage Stripe, pas du code).

### Retrouver le PaymentIntent d'un abonnement

Source : https://docs.stripe.com/api/invoice-payment/object

- Dans les versions récentes de l'API, le lien facture -> paiement passe par l'objet **InvoicePayment** : `payment.type = "payment_intent"`, `payment.payment_intent = "pi_..."`, `status` parmi `open|paid|canceled`, `amount_paid`. Chemin : `subscription.latest_invoice` -> InvoicePayment (liste filtrable par facture) -> `pi_...`. Je n'ai pas confirmé dans cette passe si `Invoice.payment_intent` existe encore à la version épinglée par le dépôt : **à vérifier contre la version d'API réellement utilisée** avant de coder le chemin.
- Le montant à rembourser pour « intégral » = `amount_paid` de la facture du premier paiement (après code promo), jamais le prix catalogue.
- Facture à 0 (code promo 100 %) : il n'y a pas de paiement, donc rien à rembourser ; enregistrer la rétractation sans appel `/refunds` (aligné avec l'issue). Un `POST /v1/refunds` sur un montant nul n'est pas documenté, donc ne pas l'appeler.

## 3. Échec de remboursement (suivi Back Office)

Source : https://docs.stripe.com/refunds#failed-refunds

- Un remboursement peut échouer plus tard (banque, carte expirée ou annulée). L'objet Refund passe à `status: "failed"` avec `failure_reason` parmi : `charge_for_pending_refund_disputed`, `declined`, `expired_or_canceled_card`, `insufficient_funds`, `lost_or_stolen_card`, `merchant_request`, `unknown`, et `failure_balance_transaction`. La banque renvoie les fonds à Stripe, jusqu'à 30 jours après.
- Événements : `refund.created`, `refund.updated`, **`refund.failed`**. Stripe recommande au minimum d'écouter `refund.created`. `charge.refund.updated` est **obsolète** (utiliser `refund.updated`). `charge.refunded` existe aussi.
- Conséquence pour l'issue : l'échec survient **de façon asynchrone** (pas dans la réponse de `POST /v1/refunds`, sauf erreur immédiate type « déjà remboursé »). Le Back Office doit donc se nourrir du webhook `refund.failed` (signature à vérifier) et pas seulement de la réponse de l'appel. Le doc dit que, en cas d'échec, « il faut prévoir un autre moyen de rembourser » : la « relance » est un nouveau `POST /v1/refunds` (le premier est `failed`), idéalement avec une nouvelle clé d'idempotence, et le montant déjà restitué à Stripe n'est plus compté comme remboursé. Un virement manuel hors Stripe est le recours si la carte est morte.
- États intermédiaires à gérer dans l'affichage : `pending`, `requires_action` (moyens sans remboursement natif : le client reçoit un e-mail de Stripe), `succeeded`, `failed`, `canceled`.

## 4. Idempotence

Source : https://docs.stripe.com/api/idempotent_requests

- En-tête `Idempotency-Key`, 255 caractères maximum, de préférence un UUID v4 ; **pas de donnée personnelle** (pas d'e-mail). Toutes les requêtes `POST` v1 l'acceptent.
- Une réponse est mémorisée même en cas d'erreur 500 ; les clés peuvent être purgées après **24 h** ; réutiliser une clé avec d'autres paramètres donne une erreur.
- Pour #511 : clé dérivée de l'identifiant interne de la rétractation (ex. `withdrawal-<uuid>-refund`) pour que le double clic sur « Confirmer la rétractation » ne rembourse pas deux fois. Au-delà de 24 h (relance manuelle), générer une nouvelle clé, et se protéger par notre propre état (le doc précise qu'un second remboursement d'un paiement déjà totalement remboursé échoue de toute façon).

## 5. Fake Stripe du dépôt

- `apps/web/src/billing/fake-stripe.ts` modélise aujourd'hui les abonnements (`cancel_at_period_end`, `cancel_at`) et les événements Checkout, mais **ni `DELETE /subscriptions/{id}`, ni `POST /refunds`, ni l'événement `refund.failed`**. L'AC « rembourse intégralement dans Stripe (fake Stripe en test) » et l'AC de relance imposent d'étendre le fake avec : annulation immédiate (`status: canceled`), création de remboursement (total, erreur sur sur-remboursement), possibilité de forcer un échec asynchrone.

## 6. Points non couverts (à ne pas considérer établis)

- Qualification juridique « service numérique » du Plan, et hypothèse « un changement de Plan dans le portail n'ouvre pas de nouveau délai » : **Juriste**, déjà signalés dans #496 et dans l'issue.
- Comportement exact de `Invoice.payment_intent` à la version d'API épinglée et de `DELETE` sur un abonnement déjà annulé : à vérifier en test avec la clé de test.
- Cas d'une carte dont le remboursement devient une annulation (`reversal`) : à afficher au Support comme « remboursé » sans ARN.
