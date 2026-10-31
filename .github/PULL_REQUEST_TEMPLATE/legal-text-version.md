<!--
Gabarit d'une Legal Text Version (ADR-0062, #507, playbook `.claude/legal.local.md`).
Une version = une PR, jamais dans une PR de livraison.
Un agent ne merge jamais cette PR : seul le product owner la merge.
-->

## Legal Text Version

- **Texte** : <!-- mentions-legales | cgu | cgv | confidentialite -->
- **Date d'effet** : <!-- AAAA-MM-JJ, fixée par le product owner -->
- **Changement** : <!-- substantielle | mineure -->
- **Fichiers** : `packages/help/legal/<texte>/<AAAA-MM-JJ>.fr.md`, `.en.md`
- **Pourquoi cette version** : <!-- issue « Légal : … » et changement du produit qui l'exige -->
- **Version précédente** : <!-- lien, ou « première version » -->

**Pas de juriste (#507).** Cette version est publiée après la seule Legal Review par IA, selon le playbook. Aucun déclencheur du juriste n'est actif (§ 8 du playbook) : <!-- « aucun » ou le déclencheur, qui suspend la PR -->

## Rapport de Legal Review

Procédure : `/legal:compliance-check` avec le playbook, puis `legal-risk-assessment` (§ 5). Version mineure : diff seul (§ 7).

### Grille

| # | Point de la grille (§ 3) | Statut | Constat |
|---|---|---|---|
| <!-- ML1 --> | | <!-- conforme / non conforme / absent / sans objet --> | |

### Constats

| Constat | Base et lien | Gravité | Probabilité | Score | Résolution |
|---|---|---|---|---|---|
| | | | | | <!-- corrigé / position prudente n° / déclencheur --> |

### Positions prudentes prises (§ 4)

- <!-- point n° : position, et où elle est écrite dans le texte -->

### Sources vérifiées

| Article | Lien (Légifrance, EUR-Lex, CNIL) | Vérifié le |
|---|---|---|
| | | |

### Traduction EN

- [ ] Fidèle au FR : même structure, mêmes ancres, rien d'ajouté ni d'omis ; « Translation: the French text prevails » en tête.

## Condition de merge (§ 6)

- [ ] Aucun constat élevé ou critique ouvert (score ≥ 10).
- [ ] Chaque article cité vérifié, avec son lien ; aucun « à vérifier » restant.
- [ ] Liste des positions prudentes prises ci-dessus.
- [ ] Aucun placeholder `[À FOURNIR : …]` dans le texte.
- [ ] Aucun déclencheur du juriste actif.

## Signature du product owner

- [ ] J'ai relu cette version, je fixe sa date d'effet et je renseigne `approved_by`. Le merge vaut signature. <!-- case cochée par le product owner seulement -->
