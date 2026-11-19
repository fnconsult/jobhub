# Recherche #1069 : « Pour bien commencer » (extension, navigateurs)

Note : le skill `mattpocock-skills:research` n'était pas disponible dans la session ; recherche faite à la main, limitée à ce que le ticket exige. developer.chrome.com était hors de la liste réseau autorisée.

## Ce que le ticket suppose de l'extérieur

1. Épingler l'extension : icône puzzle à droite de la barre d'adresse, puis « Épingler ». Confirmé par l'aide Chrome Web Store (https://support.google.com/chrome_webstore/answer/2664769) : icône Extensions (puzzle) à droite de la barre d'adresse, puis Épingler ; certaines extensions n'offrent pas l'option. Le texte du ticket est donc exact pour Chrome.
2. Pas d'installation d'extension dans Chrome sur téléphone : la page ne décrit que l'installation sur ordinateur (ou « Ajouter au bureau » depuis le téléphone). Cohérent avec « sur téléphone, l'extension n'y figure jamais ».
3. « Chromium qui accepte les extensions du Chrome Web Store » : non vérifié ici faute d'accès à la documentation. Points à trancher à l'implémentation :
   - Brave envoie un User-Agent identique à Chrome (indétectable par UA) ; Edge s'annonce par `Edg/`, Opera par `OPR/`, Vivaldi par `Vivaldi/`.
   - Opera ne lit le Chrome Web Store qu'avec un module complémentaire : à exclure ou à traiter comme « hors Chrome ».
   - Les iPad récents envoient un UA de Mac : à exclure par détection tactile.
   - Préférer `navigator.userAgentData` (brands) avec repli sur l'UA ; seul Chromium l'expose.

## Recommandation

Retenir une liste courte : Chrome et Edge sur ordinateur (via brands/UA), le reste masqué. Tester chaque cas dans les tests unitaires de la sélection. Sources à confirmer avant de figer Edge/Brave : documentation Microsoft Edge sur les extensions du Chrome Web Store.
