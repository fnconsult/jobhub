---
playbook: cv-offer-fit-scoring
version: "1.0"
updated: "2026-07-26"
statut: validé (auto-QA Claude, 2026-07-26)
sources: [S8, S9, S27, S29, S42, S43]
langue: fr
---

# Scorer une offre contre son CV et améliorer l'adéquation

## Règles

**R1. Scorez chaque offre avant de candidater, plutôt que de candidater puis d'espérer.**

Environ 50 % du score attribué par un ATS dépend des mots-clés repris de l'annonce, et un CV réécrit pour coller à l'offre peut passer de 35 % à 85 % de compatibilité. Le score n'est donc pas une fatalité : c'est une variable que vous contrôlez avant l'envoi. [S42]

**R2. Visez au minimum 75 % de recouvrement avec l'annonce avant d'envoyer.**

France Travail donne 75 % de compatibilité comme seuil de travail minimal. En dessous, ne candidatez pas en l'état : soit vous réécrivez le CV pour l'offre, soit l'offre n'est pas la bonne cible. [S42]

**R3. Pondérez les critères dans l'ordre où les recruteurs filtrent réellement.**

Les recruteurs interrogent leur base ATS d'abord par compétences (76,4 %), puis formation (59,7 %), intitulé de poste (55,3 %), certifications (50,6 %), expérience (44,3 %) et localisation (43,4 %). Un écart sur les compétences ou l'intitulé pèse donc bien plus lourd qu'un écart sur un critère secondaire : corrigez dans cet ordre. [S9]

**R4. Traitez l'intitulé de poste comme le premier levier de score, pas comme un détail cosmétique.**

Un CV reprenant l'intitulé de poste exact de l'offre reçoit jusqu'à 10,6 fois plus de demandes d'entretien. Si votre titre interne diffère de celui du marché, faites figurer les deux (titre visé en tête, titre interne dans le détail du poste). [S9]

**R5. Décomposez l'écart compétence par compétence, pas globalement.**

Listez chaque compétence exigée par l'annonce, puis classez-la : présente et prouvée par une réalisation, présente mais non visible dans le CV, réellement absente. Seule la deuxième catégorie se corrige par réécriture — c'est là que se joue l'essentiel du gain de score. [S27]

**R6. Ne comblez jamais un écart réel par un mot-clé non justifié.**

88 % des employeurs reconnaissent exclure des candidats qualifiés faute de correspondance exacte à la description de poste : la tentation est donc forte d'ajouter des termes non maîtrisés. Mais un terme non adossé à une réalisation vérifiable se retourne contre vous dès l'entretien. Un écart réel se traite par une formation, une preuve indirecte ou un changement de cible — pas par une ligne ajoutée. [S8]

**R7. Visez un recouvrement sémantique d'environ 80 à 90 %, pas une correspondance littérale mot pour mot.**

Les moteurs d'appariement récents comparent le **sens** de votre expérience à celui de l'offre plutôt que la présence littérale des termes. Les modèles les plus récents dépassent explicitement l'appariement lexical classique (BM25) de l'ordre de +13,8 % en recall et +17,5 % en nDCG. Un vocabulaire naturel, aligné sur le champ lexical de l'offre, marque mieux qu'une liste de termes copiés. [S27][S43]

**R8. Interprétez un score faible comme un signal de ciblage, pas comme un verdict sur votre valeur.**

L'ATS classe et priorise ; il ne prononce pas seul le rejet, la décision finale reste humaine. Un score bas signifie le plus souvent que l'offre ne correspond pas à votre positionnement actuel — arbitrez alors entre réécrire et renoncer à cette offre, plutôt que de forcer un dossier faible. [S42]

**R9. Ne compensez pas un mauvais ciblage par du volume, mais ne renoncez pas non plus au volume.**

54 % des entreprises rencontrent des difficultés de recrutement et, parmi elles, 74 % citent le faible nombre de candidatures reçues comme obstacle principal. Le marché souffre donc d'un déficit de candidatures autant que d'un défaut d'adéquation : une fois votre CV correctement scoré sur une famille d'offres, élargissez la diffusion à toutes les offres de cette famille plutôt que de peaufiner indéfiniment un seul dossier. [S29]

## Pièges

- **Candidater sans avoir mesuré l'écart avec l'annonce.** Le score dépend pour moitié des mots-clés repris de l'offre : c'est une variable pilotable avant l'envoi, pas un résultat subi. [S42]
- **Corriger d'abord les critères secondaires (localisation, ancienneté) en laissant un écart sur les compétences ou l'intitulé.** Ce sont les deux critères de filtrage les plus fréquents. [S9]
- **Ajouter un mot-clé pour combler un écart réel de compétence.** Le décalage se révèle en entretien et coûte plus cher qu'un dossier honnêtement incomplet. [S8]
- **Confondre recouvrement sémantique et copie littérale de l'annonce.** Les moteurs récents comparent le sens : une reprise mot pour mot se lit comme une copie, pas comme une compétence. [S27][S43]
- **Prendre un score ATS bas pour un jugement de valeur.** L'outil classe, il ne décide pas — un score bas indique surtout une offre mal ciblée. [S42]
- **Peaufiner un seul dossier au lieu d'appliquer un CV bien scoré à toute une famille d'offres.** Le premier obstacle des recruteurs est le volume de candidatures reçues, pas leur qualité. [S29]
